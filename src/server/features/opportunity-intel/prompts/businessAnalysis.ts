import { z } from "zod";
import { LLM_ADJUSTMENT_CLAMP } from "../rules/scoringRules";

export const ANALYSIS_PROMPT_VERSION = "opp-analysis-v1";

export const businessAnalysisSchema = z.object({
  positives: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe("Top positive signals, each citing the evidence given"),
  risks: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe("Top risks, each citing the evidence given"),
  recommendation: z
    .string()
    .describe("One concrete next action for a human operator"),
  adjustment: z
    .number()
    .min(-LLM_ADJUSTMENT_CLAMP)
    .max(LLM_ADJUSTMENT_CLAMP)
    .describe(
      "Bounded score adjustment in points for what the arithmetic cannot " +
        "see; 0 when the numbers already tell the story",
    ),
});

export const ANALYSIS_SYSTEM = `You are the commercial judgment pass of a cross-border opportunity funnel. You receive ONLY structured evidence already collected (keyword demand, SERP supply-gap findings). Reason strictly from it — never invent market facts, prices, or supplier claims that are not in the evidence.

Your positives/risks feed a human-readable report; your bounded adjustment nudges the deterministic score for context the arithmetic misses (e.g. the demand is thin but every query is a buyer query; or the gap score is high only because the market barely exists).`;

export function buildAnalysisPrompt(input: {
  name: string;
  type: string;
  description: string | null;
  demandBreakdown: Record<string, number | boolean>;
  snapshots: Array<{
    keyword: string;
    gapScore: number | null;
    notes: string | null;
  }>;
  sampleResults: Array<{ domain: string; pageClass: string | null }>;
}): string {
  return `Opportunity: ${input.name} (type ${input.type})
${input.description ? `Definition: ${input.description}\n` : ""}
Demand evidence: ${JSON.stringify(input.demandBreakdown)}

SERP snapshots:
${input.snapshots
  .map(
    (snapshot) =>
      `- "${snapshot.keyword}" gap ${snapshot.gapScore ?? "?"}: ${snapshot.notes ?? ""}`,
  )
  .join("\n")}

Top-ranking domains (with page class): ${input.sampleResults
    .map((result) => `${result.domain}[${result.pageClass ?? "?"}]`)
    .join(", ")}

Give positives, risks, one next action, and a bounded adjustment.`;
}
