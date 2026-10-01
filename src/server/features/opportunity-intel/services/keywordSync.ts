import { saveKeywords } from "@/server/features/keywords/services/research/saved-keywords";
import { ProjectService } from "@/server/features/projects/services/ProjectService";
import { OpportunitiesRepository } from "../repositories/OpportunitiesRepository";
import { OpportunityDecisionLogRepository } from "../repositories/OpportunityDecisionLogRepository";
import {
  OpportunityKeywordsRepository,
  type OpportunityKeywordRow,
} from "../repositories/OpportunityKeywordsRepository";
import { OpportunitySerpRepository } from "../repositories/OpportunitySerpRepository";
import { pickSyncProjectId } from "./keywordSyncPick";

const SAVE_CHUNK = 400;

type SyncKeywordRow = {
  keyword: string;
  locationCode: number;
  languageCode: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  keywordDifficulty: number | null;
  intent: string | null;
  trend: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** opportunity_keywords.trend JSON → the saved-keyword monthlySearches shape. */
function parseTrendSeries(
  trend: string | null,
): Array<{ year: number; month: number; searchVolume: number }> {
  if (!trend) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trend);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const series: Array<{ year: number; month: number; searchVolume: number }> =
    [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const { year, month, searchVolume } = item;
    if (
      typeof year === "number" &&
      year > 0 &&
      typeof month === "number" &&
      month >= 1 &&
      month <= 12 &&
      typeof searchVolume === "number" &&
      searchVolume >= 0
    ) {
      series.push({ year, month, searchVolume: Math.round(searchVolume) });
    }
  }
  return series;
}

function coarseIntent(
  intent: string | null,
): "informational" | "commercial" | "transactional" | "navigational" | null {
  switch (intent) {
    case "informational":
    case "problem":
      return "informational";
    case "transactional":
      return "transactional";
    case "navigational":
      return "navigational";
    case "commercial":
    case "service":
    case "supplier":
    case "replacement":
    case "model":
      return "commercial";
    default:
      return null;
  }
}

function readLoggedProjectId(decision: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decision);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.projectId !== "string") return null;
  return parsed.projectId.length > 0 ? parsed.projectId : null;
}

export function toSyncKeywordRow(row: OpportunityKeywordRow): SyncKeywordRow {
  return {
    keyword: row.keyword,
    locationCode: row.locationCode,
    languageCode: row.languageCode,
    searchVolume: row.searchVolume,
    cpc: row.cpc,
    competition: row.competition,
    keywordDifficulty: row.keywordDifficulty,
    intent: row.intent,
    trend: row.trend,
  };
}

async function resolveFetchSyncProjectId(
  organizationId: string,
  opportunityId: string,
): Promise<string | null> {
  const [opportunity, log, projects] = await Promise.all([
    OpportunitiesRepository.getById(organizationId, opportunityId),
    OpportunityDecisionLogRepository.listByOpportunity(opportunityId, 50),
    ProjectService.listProjectsEnsuringOne(organizationId),
  ]);
  if (!opportunity) return null;
  const lastLoggedProjectId =
    log
      .map((entry) =>
        entry.decisionType === "graduation" || entry.decisionType === "review"
          ? readLoggedProjectId(entry.decision)
          : null,
      )
      .find((projectId) => projectId !== null) ?? null;
  return pickSyncProjectId({
    graduatedProjectId: opportunity.graduatedProjectId,
    lastLoggedProjectId,
    projects,
  });
}

/** Idempotent upsert into saved_keywords. Paid metrics ride along when present. */
export async function writeKeywordRowsToProject(
  projectId: string,
  rows: SyncKeywordRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const byMarket = new Map<string, SyncKeywordRow[]>();
  for (const row of rows) {
    const key = `${row.locationCode}|${row.languageCode}`;
    const bucket = byMarket.get(key);
    if (bucket) bucket.push(row);
    else byMarket.set(key, [row]);
  }
  let written = 0;
  for (const marketRows of byMarket.values()) {
    const { locationCode, languageCode } = marketRows[0];
    for (let i = 0; i < marketRows.length; i += SAVE_CHUNK) {
      const chunk = marketRows.slice(i, i + SAVE_CHUNK);
      await saveKeywords({
        projectId,
        keywords: chunk.map((row) => row.keyword),
        locationCode,
        languageCode,
        source: "opportunity",
        metrics: chunk.map((row) => ({
          keyword: row.keyword,
          searchVolume: row.searchVolume,
          cpc: row.cpc,
          competition: row.competition,
          keywordDifficulty: row.keywordDifficulty,
          intent: coarseIntent(row.intent),
          monthlySearches: parseTrendSeries(row.trend),
        })),
      });
      written += chunk.length;
    }
  }
  return written;
}

/**
 * Write rows we just paid to fetch. Does not wait for intent / gates /
 * graduation. No-ops when the org has no project to attach to. Fetch
 * failures must not be caused by this write — callers catch.
 */
export async function syncFetchedKeywordsToProject(input: {
  organizationId: string;
  opportunityId: string;
  rows: SyncKeywordRow[];
}): Promise<number> {
  if (input.rows.length === 0) return 0;
  const projectId = await resolveFetchSyncProjectId(
    input.organizationId,
    input.opportunityId,
  );
  if (!projectId) return 0;
  return writeKeywordRowsToProject(projectId, input.rows);
}

/** Keyword rows plus any snapshot-only texts the current set no longer has. */
export async function collectRowsToSync(
  opportunityId: string,
): Promise<SyncKeywordRow[]> {
  const [rows, snapshots] = await Promise.all([
    OpportunityKeywordsRepository.listByOpportunity(opportunityId),
    OpportunitySerpRepository.listSnapshots(opportunityId),
  ]);
  const byKey = new Map<string, SyncKeywordRow>();
  for (const row of rows) {
    byKey.set(`${row.keyword}|${row.locationCode}`, toSyncKeywordRow(row));
  }
  for (const snapshot of snapshots) {
    const key = `${snapshot.keyword}|${snapshot.locationCode}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      keyword: snapshot.keyword,
      locationCode: snapshot.locationCode,
      languageCode: snapshot.languageCode,
      searchVolume: null,
      cpc: null,
      competition: null,
      keywordDifficulty: null,
      intent: null,
      trend: null,
    });
  }
  return [...byKey.values()];
}
