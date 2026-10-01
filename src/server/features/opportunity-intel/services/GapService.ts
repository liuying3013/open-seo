import { mapWithConcurrency } from "@/server/lib/concurrency";
import {
  GAP_PROMPT_VERSION,
  GAP_SYSTEM,
  buildGapPrompt,
  gapAnalysisSchema,
} from "../prompts/gapAnalysis";
import { computeGapScore, type GapSignals } from "../rules/computeScores";
import {
  CONCURRENCY,
  RULE_VERSION,
  type PageClass,
} from "../rules/scoringRules";
import { OpportunityDecisionLogRepository } from "../repositories/OpportunityDecisionLogRepository";
import { OpportunitySerpRepository } from "../repositories/OpportunitySerpRepository";
import { runOpportunityLlm } from "./llm";

// Stage 6: one LLM pass per un-analyzed snapshot classifies every result's
// page class and estimates snapshot-level gap signals; the gap score itself is
// pure arithmetic (rules module). Idempotent: snapshots with gap_signals set
// are never re-analyzed.

async function analyzeOpportunitySerps(input: {
  organizationId: string;
  opportunityId: string;
  runId?: string | null;
}): Promise<{ analyzed: number }> {
  const snapshots = await OpportunitySerpRepository.listSnapshots(
    input.opportunityId,
  );
  const pending = snapshots.filter((snapshot) => snapshot.gapSignals === null);
  if (pending.length === 0) return { analyzed: 0 };

  let model: string | null = null;
  const summaries: Array<{
    keyword: string;
    locationCode: number;
    gapScore: number;
    signals: GapSignals;
  }> = [];

  // Snapshots are independent; analyze them in a small pool. A budget error
  // from the LLM seam propagates after in-flight snapshots land their writes.
  await mapWithConcurrency(
    pending,
    CONCURRENCY.llmCallsPerOpportunity,
    async (snapshot) => {
      const results = await OpportunitySerpRepository.getResults([snapshot.id]);
      let signals: GapSignals;
      let notes: string;
      const pageClassById = new Map<string, PageClass>();

      if (results.length === 0) {
        signals = { intentMismatch: 0, weakDomainShare: 0, outdatedShare: 0 };
        notes = "Empty SERP — no results to analyze.";
      } else {
        const { object, model: usedModel } = await runOpportunityLlm({
          organizationId: input.organizationId,
          endpoint: "llm_gap",
          schema: gapAnalysisSchema,
          system: GAP_SYSTEM,
          prompt: buildGapPrompt({
            keyword: snapshot.keyword,
            results: results.map((result, index) => ({
              index,
              rank: result.rank,
              domain: result.domain,
              title: result.title,
              description: result.description,
              resultType: result.resultType,
            })),
          }),
          opportunityId: input.opportunityId,
          runId: input.runId,
        });
        model = usedModel;
        for (const item of object.classifications) {
          const result = results[item.index];
          if (result) pageClassById.set(result.id, item.pageClass);
        }
        signals = {
          intentMismatch: object.intentMismatch,
          weakDomainShare: object.weakDomainShare,
          outdatedShare: object.outdatedShare,
        };
        notes = object.notes;
        await OpportunitySerpRepository.updateResultPageClasses(
          [...pageClassById.entries()].map(([resultId, pageClass]) => ({
            resultId,
            pageClass,
          })),
        );
      }

      const gapScore = computeGapScore(
        results.map((result) => ({
          rank: result.rank,
          resultType: result.resultType,
          pageClass: pageClassById.get(result.id) ?? result.pageClass,
        })),
        results.length > 0 ? signals : null,
      );
      await OpportunitySerpRepository.updateGap(snapshot.id, {
        gapSignals: JSON.stringify({ ...signals, notes }),
        gapScore,
      });
      summaries.push({
        keyword: snapshot.keyword,
        locationCode: snapshot.locationCode,
        gapScore,
        signals,
      });
    },
  );

  await OpportunityDecisionLogRepository.append({
    opportunityId: input.opportunityId,
    decisionType: "serp_gap_analysis",
    decision: JSON.stringify({ snapshots: summaries }),
    reasonSummary: `Analyzed ${summaries.length} snapshot(s); gap scores ${summaries
      .map((summary) => summary.gapScore)
      .join(", ")}.`,
    model,
    promptVersion: GAP_PROMPT_VERSION,
    ruleVersion: RULE_VERSION,
    createdBy: "system",
  });

  return { analyzed: summaries.length };
}

export const GapService = {
  analyzeOpportunitySerps,
};
