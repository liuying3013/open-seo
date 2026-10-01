import { OpportunityIntelError } from "../opportunityIntelErrors";
import {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SYSTEM,
  buildAnalysisPrompt,
  businessAnalysisSchema,
} from "../prompts/businessAnalysis";
import {
  computeCompetitorWeakness,
  computeConfidence,
  computeDemandScore,
  computeOpportunityScore,
  computeSeoScalability,
  evaluateSerpGate,
  type GapSignals,
} from "../rules/computeScores";
import {
  IP_RISK_SCORE,
  RULE_VERSION,
  SERP_KEYWORDS_PER_OPPORTUNITY,
} from "../rules/scoringRules";
import {
  assertOpportunityTransition,
  type OpportunityStatus,
} from "../stateMachine";
import { OpportunitiesRepository } from "../repositories/OpportunitiesRepository";
import { OpportunityDecisionLogRepository } from "../repositories/OpportunityDecisionLogRepository";
import { OpportunityKeywordsRepository } from "../repositories/OpportunityKeywordsRepository";
import { OpportunityScoresRepository } from "../repositories/OpportunityScoresRepository";
import { OpportunitySerpRepository } from "../repositories/OpportunitySerpRepository";
import { runOpportunityLlm } from "./llm";

// Stage 7: the SERP-stage score. Dimensions are arithmetic over stored rows;
// one LLM business-analysis pass contributes positives/risks/next-action for
// the report plus a bounded adjustment. Then the deterministic SERP gate
// moves the opportunity to SHORTLISTED / WATCHLIST / REJECTED (IP-risk red
// can never shortlist).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" ? value : 0;
}

function parseSignals(gapSignals: string | null): GapSignals | null {
  if (!gapSignals) return null;
  try {
    const parsed: unknown = JSON.parse(gapSignals);
    if (!isRecord(parsed)) return null;
    return {
      intentMismatch: numField(parsed, "intentMismatch"),
      weakDomainShare: numField(parsed, "weakDomainShare"),
      outdatedShare: numField(parsed, "outdatedShare"),
    };
  } catch {
    return null;
  }
}

function ageInDays(newestIso: string | null): number | null {
  if (!newestIso) return null;
  return Math.max(
    0,
    (Date.now() - new Date(newestIso).getTime()) / (24 * 60 * 60 * 1000),
  );
}

async function scoreAndGate(input: {
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

  const latest = await OpportunitySerpRepository.getLatestWithResults(
    input.opportunityId,
  );
  const analyzed = latest.filter((entry) => entry.snapshot.gapScore !== null);
  if (analyzed.length === 0) {
    // SERP evidence not ready (budget pause mid-pipeline) — stay put; the
    // next run resumes here.
    return { outcome: "skipped" as const };
  }

  const keywordRows = await OpportunityKeywordsRepository.listByOpportunity(
    input.opportunityId,
  );
  const scorable = keywordRows.map((row) => ({
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

  const gapScores = analyzed.map((entry) => entry.snapshot.gapScore ?? 0);
  const serpSupplyGap =
    gapScores.reduce((sum, score) => sum + score, 0) / gapScores.length;
  const allResults = analyzed.flatMap((entry) =>
    entry.results.map((result) => ({
      rank: result.rank,
      resultType: result.resultType,
      pageClass: result.pageClass,
      domain: result.domain,
    })),
  );
  const signalsList = analyzed
    .map((entry) => parseSignals(entry.snapshot.gapSignals))
    .filter((signals): signals is GapSignals => signals !== null);
  const avgSignals: GapSignals | null =
    signalsList.length > 0
      ? {
          intentMismatch:
            signalsList.reduce((sum, s) => sum + s.intentMismatch, 0) /
            signalsList.length,
          weakDomainShare:
            signalsList.reduce((sum, s) => sum + s.weakDomainShare, 0) /
            signalsList.length,
          outdatedShare:
            signalsList.reduce((sum, s) => sum + s.outdatedShare, 0) /
            signalsList.length,
        }
      : null;
  const competitorWeakness = computeCompetitorWeakness(allResults, avgSignals);

  const { object: analysis, model } = await runOpportunityLlm({
    organizationId: input.organizationId,
    endpoint: "llm_analysis",
    schema: businessAnalysisSchema,
    system: ANALYSIS_SYSTEM,
    prompt: buildAnalysisPrompt({
      name: opportunity.name,
      type: opportunity.type,
      description: opportunity.description,
      demandBreakdown: demand.breakdown,
      snapshots: analyzed.map((entry) => ({
        keyword: entry.snapshot.keyword,
        gapScore: entry.snapshot.gapScore,
        notes: entry.snapshot.gapSignals,
      })),
      sampleResults: allResults
        .filter((result) => result.rank <= 10)
        .slice(0, 30)
        .map((result) => ({
          domain: result.domain,
          pageClass: result.pageClass,
        })),
    }),
    opportunityId: input.opportunityId,
    runId: input.runId,
  });

  const total = computeOpportunityScore({
    dimensions: {
      commercialSearchDemand: demand.score,
      serpSupplyGap,
      competitorWeakness,
      seoScalability,
      ipLegalRisk,
    },
    llmAdjustment: analysis.adjustment,
  });

  const countries: unknown = JSON.parse(opportunity.targetCountries);
  const marketCount = Array.isArray(countries)
    ? Math.max(1, countries.length)
    : 1;
  const newestSnapshotAt = analyzed.reduce<string | null>(
    (newest, entry) =>
      !newest || entry.snapshot.fetchedAt > newest
        ? entry.snapshot.fetchedAt
        : newest,
    null,
  );
  const confidence = computeConfidence({
    keywordCount: new Set(keywordRows.map((row) => row.keyword)).size,
    metricsCoveredShare:
      keywordRows.length > 0
        ? keywordRows.filter((row) => row.metricsFetchedAt !== null).length /
          keywordRows.length
        : 0,
    serpPlanned: SERP_KEYWORDS_PER_OPPORTUNITY * marketCount,
    serpFetched: analyzed.length,
    evidenceAgeDays: ageInDays(newestSnapshotAt),
    stage: "serp",
  });

  const breakdown = JSON.stringify({
    ...total.breakdown,
    demand: demand.breakdown,
    serpSupplyGap,
    competitorWeakness,
    perSnapshotGap: analyzed.map((entry) => ({
      keyword: entry.snapshot.keyword,
      gapScore: entry.snapshot.gapScore,
    })),
    analysis,
  });
  await OpportunityScoresRepository.insert({
    opportunityId: input.opportunityId,
    stage: "serp",
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
      stage: "serp",
      snapshots: analyzed.length,
      keywordCount: keywordRows.length,
    }),
    decision: breakdown,
    reasonSummary: `SERP-stage score ${total.score} (confidence ${confidence}).`,
    model,
    promptVersion: ANALYSIS_PROMPT_VERSION,
    ruleVersion: RULE_VERSION,
    createdBy: "system",
  });

  // Two logged transitions: evidence complete (serp_validated), then the gate.
  assertOpportunityTransition(fromStatus, "serp_validated");
  const evidenceTransitioned = await OpportunitiesRepository.updateStatus(
    input.organizationId,
    input.opportunityId,
    fromStatus,
    "serp_validated",
  );
  if (!evidenceTransitioned) {
    throw new OpportunityIntelError(
      "INVALID_STATUS_TRANSITION",
      "Opportunity changed while SERP scoring was running; rerun the scan.",
    );
  }
  const gate = evaluateSerpGate({
    score: total.score,
    ipRisk: opportunity.ipRisk,
  });
  const target: OpportunityStatus =
    gate.outcome === "shortlist"
      ? "shortlisted"
      : gate.outcome === "watchlist"
        ? "watchlist"
        : "rejected";
  assertOpportunityTransition("serp_validated", target);
  const gateTransitioned = await OpportunitiesRepository.updateStatus(
    input.organizationId,
    input.opportunityId,
    "serp_validated",
    target,
  );
  if (!gateTransitioned) {
    throw new OpportunityIntelError(
      "INVALID_STATUS_TRANSITION",
      "Opportunity changed while the SERP gate was being applied; rerun the scan.",
    );
  }
  await OpportunityDecisionLogRepository.append({
    opportunityId: input.opportunityId,
    decisionType: "gate_transition",
    decision: JSON.stringify({
      gate: "serp",
      outcome: gate.outcome,
      from: fromStatus,
      to: target,
      score: total.score,
      ipRisk: opportunity.ipRisk,
    }),
    reasonSummary: gate.reason,
    ruleVersion: RULE_VERSION,
    createdBy: "system",
  });

  return {
    outcome: gate.outcome,
    score: total.score,
    confidence,
  };
}

export const ScoringService = {
  scoreAndGate,
};
