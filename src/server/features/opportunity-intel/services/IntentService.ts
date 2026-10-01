import { mapWithConcurrency } from "@/server/lib/concurrency";
import { OpportunityIntelError } from "../opportunityIntelErrors";
import {
  CLASSIFY_INTENTS_PROMPT_VERSION,
  CLASSIFY_INTENTS_SYSTEM,
  buildClassifyIntentsPrompt,
  classifyIntentsSchema,
} from "../prompts/classifyIntents";
import {
  computeConfidence,
  computeDemandScore,
  computeOpportunityScore,
  computeSeoScalability,
  evaluateDemandGate,
} from "../rules/computeScores";
import {
  CONCURRENCY,
  IP_RISK_SCORE,
  MIN_UNIT_PRICE_USD,
  RULE_VERSION,
  RUN_CAPS,
} from "../rules/scoringRules";
import {
  assertOpportunityTransition,
  type OpportunityStatus,
} from "../stateMachine";
import { OpportunitiesRepository } from "../repositories/OpportunitiesRepository";
import { OpportunityDecisionLogRepository } from "../repositories/OpportunityDecisionLogRepository";
import { OpportunityKeywordsRepository } from "../repositories/OpportunityKeywordsRepository";
import { OpportunityScoresRepository } from "../repositories/OpportunityScoresRepository";
import { runOpportunityLlm } from "./llm";

// Stage 4: LLM fine-intent classification (batched, once per keyword TEXT),
// then the keyword-stage score + the deterministic demand gate. This is where
// a DISCOVERED opportunity becomes KEYWORD_SCANNED, WATCHLIST, or REJECTED.

function ageInDays(newestIso: string | null): number | null {
  if (!newestIso) return null;
  return Math.max(
    0,
    (Date.now() - new Date(newestIso).getTime()) / (24 * 60 * 60 * 1000),
  );
}

async function classifyAndGate(input: {
  organizationId: string;
  opportunityId: string;
  runId?: string | null;
}) {
  const opportunity = await OpportunitiesRepository.getById(
    input.organizationId,
    input.opportunityId,
  );
  if (!opportunity) {
    throw new OpportunityIntelError(
      "OPPORTUNITY_NOT_FOUND",
      "Opportunity not found.",
    );
  }
  const fromStatus = opportunity.status;

  // Classify each distinct keyword text once; the update fans out to all its
  // country rows. Already-classified texts are skipped (idempotent rerun).
  const rows = await OpportunityKeywordsRepository.listByOpportunity(
    input.opportunityId,
  );
  const unclassified = [
    ...new Set(
      rows.filter((row) => row.intent === null).map((row) => row.keyword),
    ),
  ];
  let model: string | null = null;
  const intentCounts: Record<string, number> = {};
  const batches: string[][] = [];
  for (let i = 0; i < unclassified.length; i += RUN_CAPS.intentBatchSize) {
    batches.push(unclassified.slice(i, i + RUN_CAPS.intentBatchSize));
  }
  // Batches touch disjoint keyword sets, so they classify in parallel.
  await mapWithConcurrency(
    batches,
    CONCURRENCY.llmCallsPerOpportunity,
    async (batch) => {
      const result = await runOpportunityLlm({
        organizationId: input.organizationId,
        endpoint: "llm_intent",
        schema: classifyIntentsSchema,
        system: CLASSIFY_INTENTS_SYSTEM,
        prompt: buildClassifyIntentsPrompt(batch),
        opportunityId: input.opportunityId,
        runId: input.runId,
      });
      model = result.model;
      const byIntent = new Map<string, string[]>();
      for (const item of result.object.classifications) {
        const bucket = byIntent.get(item.intent);
        if (bucket) bucket.push(item.keyword);
        else byIntent.set(item.intent, [item.keyword]);
      }
      for (const [intent, keywords] of byIntent) {
        await OpportunityKeywordsRepository.updateIntentByKeyword(
          input.opportunityId,
          keywords,
          intent,
        );
        intentCounts[intent] = (intentCounts[intent] ?? 0) + keywords.length;
      }
    },
  );
  if (unclassified.length > 0) {
    await OpportunityDecisionLogRepository.append({
      opportunityId: input.opportunityId,
      decisionType: "intent_classification",
      decision: JSON.stringify({
        classified: unclassified.length,
        intentCounts,
      }),
      model,
      promptVersion: CLASSIFY_INTENTS_PROMPT_VERSION,
      createdBy: "system",
    });
  }

  // Keyword-stage score: demand + keyword-derived dimensions, renormalized.
  const fresh = await OpportunityKeywordsRepository.listByOpportunity(
    input.opportunityId,
  );
  const scorable = fresh.map((row) => ({
    role: row.role,
    intent: row.intent,
    searchVolume: row.searchVolume,
    cpc: row.cpc,
  }));
  const demand = computeDemandScore({
    type: opportunity.type,
    keywords: scorable,
  });
  const seoScalability = computeSeoScalability(scorable);
  const ipLegalRisk = IP_RISK_SCORE[opportunity.ipRisk];
  const total = computeOpportunityScore({
    dimensions: {
      commercialSearchDemand: demand.score,
      seoScalability,
      ipLegalRisk,
    },
  });
  const newestMetricsAt = fresh.reduce<string | null>(
    (newest, row) =>
      row.metricsFetchedAt && (!newest || row.metricsFetchedAt > newest)
        ? row.metricsFetchedAt
        : newest,
    null,
  );
  const confidence = computeConfidence({
    keywordCount: new Set(fresh.map((row) => row.keyword)).size,
    metricsCoveredShare:
      fresh.length > 0
        ? fresh.filter((row) => row.metricsFetchedAt !== null).length /
          fresh.length
        : 0,
    serpPlanned: 0,
    serpFetched: 0,
    evidenceAgeDays: ageInDays(newestMetricsAt),
    stage: "keyword",
  });
  const breakdown = JSON.stringify({
    ...total.breakdown,
    demand: demand.breakdown,
  });
  await OpportunityScoresRepository.insert({
    opportunityId: input.opportunityId,
    stage: "keyword",
    score: total.score,
    confidence,
    scoreVersion: RULE_VERSION,
    breakdown,
  });
  await OpportunitiesRepository.updateFields(
    input.organizationId,
    input.opportunityId,
    {
      latestScore: total.score,
      latestConfidence: confidence,
      latestScoreVersion: RULE_VERSION,
    },
  );
  await OpportunityDecisionLogRepository.append({
    opportunityId: input.opportunityId,
    decisionType: "scoring",
    inputSnapshot: JSON.stringify({
      stage: "keyword",
      keywordCount: fresh.length,
    }),
    decision: breakdown,
    reasonSummary: `Keyword-stage score ${total.score} (confidence ${confidence}).`,
    ruleVersion: RULE_VERSION,
    createdBy: "system",
  });

  // Operator ticket floor: sub-$500 unit-price opportunities never earn paid
  // SERP work — they park on the watchlist with an explicit reason.
  let gate = evaluateDemandGate(demand.score);
  const price = opportunity.estimatedUnitPriceUsd;
  if (
    gate.outcome === "advance" &&
    price !== null &&
    price < MIN_UNIT_PRICE_USD
  ) {
    gate = {
      outcome: "watchlist",
      reason: `Estimated unit price $${price} is below the $${MIN_UNIT_PRICE_USD} ticket floor — parked before SERP spend.`,
    };
  }
  const target: OpportunityStatus =
    gate.outcome === "advance"
      ? "keyword_scanned"
      : gate.outcome === "watchlist"
        ? "watchlist"
        : "rejected";
  assertOpportunityTransition(fromStatus, target);
  const transitioned = await OpportunitiesRepository.updateStatus(
    input.organizationId,
    input.opportunityId,
    fromStatus,
    target,
  );
  if (!transitioned) {
    throw new OpportunityIntelError(
      "INVALID_STATUS_TRANSITION",
      "Opportunity changed while the demand gate was running; rerun the scan.",
    );
  }
  await OpportunityDecisionLogRepository.append({
    opportunityId: input.opportunityId,
    decisionType: "gate_transition",
    decision: JSON.stringify({
      gate: "demand",
      outcome: gate.outcome,
      from: fromStatus,
      to: target,
      demandScore: demand.score,
      laneApplied: demand.laneApplied,
    }),
    reasonSummary: gate.reason,
    ruleVersion: RULE_VERSION,
    createdBy: "system",
  });

  return {
    outcome: gate.outcome,
    demandScore: demand.score,
    score: total.score,
    confidence,
  };
}

export const IntentService = {
  classifyAndGate,
};
