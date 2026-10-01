import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { opportunityKeywords } from "@/db/schema";
import type { KeywordRole } from "../rules/keywordTemplates";

export type OpportunityKeywordRow = typeof opportunityKeywords.$inferSelect;

type NewOpportunityKeyword = {
  keyword: string;
  role: KeywordRole;
  locationCode: number;
  languageCode: string;
};

// D1 caps bound parameters at 100 per statement; 10 rows x 6 params stays
// well below it (matches content-ops ROWS_PER_INSERT).
const INSERT_CHUNK = 10;

/** Idempotent: rows colliding on the (opportunity, keyword, location, language)
 * unique index are silently skipped, so re-running expansion never duplicates. */
async function insertMany(
  opportunityId: string,
  rows: NewOpportunityKeyword[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    await db
      .insert(opportunityKeywords)
      .values(
        chunk.map((row) => ({
          id: crypto.randomUUID(),
          opportunityId,
          ...row,
        })),
      )
      .onConflictDoNothing();
  }
}

async function listByOpportunity(
  opportunityId: string,
): Promise<OpportunityKeywordRow[]> {
  return db
    .select()
    .from(opportunityKeywords)
    .where(eq(opportunityKeywords.opportunityId, opportunityId));
}

/** Keywords whose metrics were never fetched or are older than staleBefore. */
async function listNeedingMetrics(
  opportunityId: string,
  staleBefore: string,
): Promise<OpportunityKeywordRow[]> {
  const rows = await listByOpportunity(opportunityId);
  return rows.filter(
    (row) =>
      row.metricsFetchedAt === null || row.metricsFetchedAt < staleBefore,
  );
}

async function updateMetricsById(
  id: string,
  metrics: {
    searchVolume: number | null;
    cpc: number | null;
    competition: number | null;
    keywordDifficulty: number | null;
    trend: string | null;
    metricsFetchedAt: string;
  },
): Promise<void> {
  await db
    .update(opportunityKeywords)
    .set(metrics)
    .where(eq(opportunityKeywords.id, id));
}

/** Intent is classified once per keyword TEXT and applied to all its country rows. */
async function updateIntentByKeyword(
  opportunityId: string,
  keywords: string[],
  intent: string,
): Promise<void> {
  if (keywords.length === 0) return;
  await db
    .update(opportunityKeywords)
    .set({ intent })
    .where(
      and(
        eq(opportunityKeywords.opportunityId, opportunityId),
        inArray(opportunityKeywords.keyword, keywords),
        isNull(opportunityKeywords.intent),
      ),
    );
}

export const OpportunityKeywordsRepository = {
  insertMany,
  listByOpportunity,
  listNeedingMetrics,
  updateMetricsById,
  updateIntentByKeyword,
};
