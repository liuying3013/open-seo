import { env } from "cloudflare:workers";
import { sort } from "remeda";
import { mapWithConcurrency } from "@/server/lib/concurrency";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { createDataforseoClient } from "@/server/lib/dataforseo/client";
import type { SerpLiveItem } from "@/server/lib/dataforseo/serp";
import { flattenSerpItems } from "@/server/lib/serp/flattenSerpItems";
import { platformForDomain } from "@/server/lib/serp/platformMap";
import { OpportunityIntelError } from "../opportunityIntelErrors";
import {
  COMMERCIAL_INTENTS,
  CONCURRENCY,
  RUN_CAPS,
  SERP_DEPTH,
  SERP_KEYWORDS_PER_OPPORTUNITY,
} from "../rules/scoringRules";
import { OpportunitiesRepository } from "../repositories/OpportunitiesRepository";
import {
  OpportunityKeywordsRepository,
  type OpportunityKeywordRow,
} from "../repositories/OpportunityKeywordsRepository";
import { OpportunitySerpRepository } from "../repositories/OpportunitySerpRepository";
import { checkDailyBudget, recordCostEvent } from "./costs";
import { collectRowsToSync, syncFetchedKeywordsToProject } from "./keywordSync";

// Stage 5: fetch advanced SERPs (depth 20, desktop) for the opportunity's
// top commercial keywords in each target market. Idempotent: (keyword,
// location) pairs with a snapshot younger than serpRefetchDays are skipped,
// so a rerun never double-charges; refetching later appends new snapshots.

const RAW_PAYLOAD_PREFIX = "opportunity-intel/serp-raw/";
const COMMERCIAL_INTENT_SET = new Set<string>(COMMERCIAL_INTENTS);
const COMMERCIAL_ROLE_FALLBACK = new Set([
  "commercial",
  "service",
  "supplier",
  "model",
  "seed",
]);

/**
 * Deterministic representative selection: distinct keyword texts with
 * commercial evidence (fine intent, else commercial-ish role), ranked by
 * volume then CPC then text.
 */
function selectRepresentatives(rows: OpportunityKeywordRow[]): string[] {
  const commercial = rows.filter((row) =>
    row.intent
      ? COMMERCIAL_INTENT_SET.has(row.intent)
      : COMMERCIAL_ROLE_FALLBACK.has(row.role),
  );
  const byKeyword = new Map<string, { volume: number; cpc: number }>();
  for (const row of commercial) {
    const entry = byKeyword.get(row.keyword) ?? { volume: 0, cpc: 0 };
    entry.volume = Math.max(entry.volume, row.searchVolume ?? 0);
    entry.cpc = Math.max(entry.cpc, row.cpc ?? 0);
    byKeyword.set(row.keyword, entry);
  }
  return sort(
    [...byKeyword.entries()],
    ([aKeyword, a], [bKeyword, b]) =>
      b.volume - a.volume || b.cpc - a.cpc || aKeyword.localeCompare(bKeyword),
  )
    .slice(0, SERP_KEYWORDS_PER_OPPORTUNITY)
    .map(([keyword]) => keyword);
}

async function fetchOpportunitySerps(input: {
  opportunityId: string;
  customer: BillingCustomerContext;
  runId?: string | null;
}): Promise<{ fetched: number; skipped: number }> {
  const opportunity = await OpportunitiesRepository.getById(
    input.customer.organizationId,
    input.opportunityId,
  );
  if (!opportunity) {
    throw new OpportunityIntelError(
      "OPPORTUNITY_NOT_FOUND",
      "Opportunity not found.",
    );
  }
  const rows = await OpportunityKeywordsRepository.listByOpportunity(
    input.opportunityId,
  );
  const representatives = new Set(selectRepresentatives(rows));

  // One fetch target per (representative keyword, market) it has a row in.
  const targets = rows.filter((row) => representatives.has(row.keyword));
  const freshCutoff = new Date(
    Date.now() - RUN_CAPS.serpRefetchDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const snapshots = await OpportunitySerpRepository.listSnapshots(
    input.opportunityId,
  );
  const fresh = new Set(
    snapshots
      .filter((snapshot) => snapshot.fetchedAt >= freshCutoff)
      .map((snapshot) => `${snapshot.keyword}|${snapshot.locationCode}`),
  );

  const client = createDataforseoClient(input.customer);
  let fetched = 0;
  let skipped = 0;
  let lastError: unknown = null;
  let budgetError: unknown = null;
  const pending: typeof targets = [];
  for (const target of targets) {
    const key = `${target.keyword}|${target.locationCode}`;
    if (fresh.has(key)) {
      skipped += 1;
      continue;
    }
    fresh.add(key);
    pending.push(target);
  }
  // Fetches within one opportunity are independent; run them in a small pool.
  // Budget exhaustion must still pause the whole run (cooperative stop so
  // in-flight fetches land their snapshots) — only per-keyword fetch failures
  // are tolerated (DataForSEO occasionally 500s on one specific query; that
  // must not block the opportunity's other keywords).
  const stop = { stopped: false };
  await mapWithConcurrency(
    pending,
    CONCURRENCY.serpFetchesPerOpportunity,
    async (target) => {
      try {
        await checkDailyBudget(input.customer.organizationId, "serp_advanced");
      } catch (error) {
        budgetError ??= error;
        stop.stopped = true;
        return;
      }
      let items: SerpLiveItem[];
      try {
        items = await client.serp.live({
          keyword: target.keyword,
          locationCode: target.locationCode,
          languageCode: target.languageCode,
          depth: SERP_DEPTH,
        });
      } catch (error) {
        lastError = error;
        return;
      }
      await recordCostEvent({
        organizationId: input.customer.organizationId,
        provider: "dataforseo",
        endpoint: "serp_advanced",
        opportunityId: input.opportunityId,
        runId: input.runId,
      });
      const {
        rows: flatRows,
        features,
        relatedSearches,
      } = flattenSerpItems(items);
      await OpportunitySerpRepository.insertSnapshot({
        opportunityId: input.opportunityId,
        keyword: target.keyword,
        locationCode: target.locationCode,
        languageCode: target.languageCode,
        device: "desktop",
        resultCount: flatRows.length,
        serpFeatures: JSON.stringify({ features, relatedSearches }),
        r2Key: await storeRawPayload(crypto.randomUUID(), items),
        results: flatRows.map((row) => ({
          ...row,
          platform: platformForDomain(row.domain),
        })),
      });
      fetched += 1;
    },
    stop,
  );
  if (budgetError !== null) throw budgetError;

  // Every attempted keyword failed and nothing was ever fetched: surface the
  // upstream error so the runner records it and the opportunity stays put.
  if (fetched === 0 && lastError !== null && snapshots.length === 0) {
    throw lastError;
  }
  // Write every keyword we have a snapshot for now — not after gap analysis
  // or the commercial-intent gate. Saved Keywords reads archived SERP by
  // exact keyword+location, so the row must exist as soon as we paid.
  try {
    const snapshotKeys = new Set(
      (await OpportunitySerpRepository.listSnapshots(input.opportunityId)).map(
        (snapshot) => `${snapshot.keyword}|${snapshot.locationCode}`,
      ),
    );
    const rowsToSync = (await collectRowsToSync(input.opportunityId)).filter(
      (row) => snapshotKeys.has(`${row.keyword}|${row.locationCode}`),
    );
    await syncFetchedKeywordsToProject({
      organizationId: input.customer.organizationId,
      opportunityId: input.opportunityId,
      rows: rowsToSync,
    });
  } catch (error) {
    console.error(
      "[opportunity-intel] fetch-time saved-keyword sync failed after SERP",
      error,
    );
  }
  return { fetched, skipped };
}

// R2 raw-payload storage is best-effort: losing the raw JSON never fails the
// fetch (the distilled rows are already the system of record).
async function storeRawPayload(
  key: string,
  items: SerpLiveItem[],
): Promise<string | null> {
  const r2Key = `${RAW_PAYLOAD_PREFIX}${key}.json`;
  try {
    await env.R2.put(r2Key, JSON.stringify(items), {
      httpMetadata: { contentType: "application/json" },
    });
    return r2Key;
  } catch {
    return null;
  }
}

export const OpportunitySerpService = {
  fetchOpportunitySerps,
};
