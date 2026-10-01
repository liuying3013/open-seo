// QA rules for generated drafts (specs/0013 section 7.5). QA is an independent
// step, not a flourish on the end of generation: the model that wrote a page is
// the worst judge of whether its facts are grounded.

export const QA_RULE_VERSION = "qa-v1";

/**
 * How many times a draft may be sent back for automatic repair.
 *
 * Two, because the third rewrite is where a model stops fixing the problem and
 * starts rephrasing around it. Anything still failing after that is a content
 * problem, not a wording problem, and goes to a human.
 */
export const MAX_AUTO_FIX_ROUNDS = 2;

export const QA_DIMENSIONS = [
  "factual_grounding",
  "answers_the_query",
  "project_boundary",
  "duplicate_content",
  "expression_quality",
  "technical_requirements",
] as const;
export type QaDimension = (typeof QA_DIMENSIONS)[number];

export type QaFinding = {
  dimension: QaDimension;
  severity: "blocker" | "fix" | "note";
  detail: string;
};

/**
 * Dimensions an automatic rewrite is allowed to attempt. The three left out
 * are not wording problems:
 *
 * - factual_grounding: a claim with no source needs evidence, and a model
 *   asked to "fix" it will invent one.
 * - project_boundary: writing about a category the business does not sell is
 *   a decision to reverse, not a paragraph to soften.
 * - duplicate_content: overlapping with our own page is a coverage decision
 *   (F6), and rewriting to look different makes cannibalization harder to see.
 */
const AUTO_FIXABLE: ReadonlySet<QaDimension> = new Set([
  "answers_the_query",
  "expression_quality",
  "technical_requirements",
]);

export function isAutoFixable(finding: QaFinding): boolean {
  return finding.severity !== "blocker" && AUTO_FIXABLE.has(finding.dimension);
}

type QaVerdict = "pass" | "auto_fix" | "human_review";

/**
 * The verdict from a round's findings. Order matters: anything unfixable
 * reaches a human even when fixable problems exist alongside it, and running
 * out of rounds escalates rather than shipping.
 */
export function verdictFor(input: {
  findings: QaFinding[];
  roundsUsed: number;
}): QaVerdict {
  if (input.findings.length === 0) return "pass";
  const unfixable = input.findings.filter((f) => !isAutoFixable(f));
  if (unfixable.length > 0) return "human_review";
  if (input.roundsUsed >= MAX_AUTO_FIX_ROUNDS) return "human_review";
  return "auto_fix";
}

/** A one-line account of why a draft ended where it did. */
export function explainVerdict(input: {
  verdict: QaVerdict;
  findings: QaFinding[];
  roundsUsed: number;
}): string {
  if (input.verdict === "pass") {
    return `Passed QA with no findings after ${input.roundsUsed} auto-fix round(s).`;
  }
  const unfixable = input.findings.filter((f) => !isAutoFixable(f));
  if (unfixable.length > 0) {
    return (
      `${unfixable.length} finding(s) a rewrite cannot fix: ` +
      unfixable.map((f) => `${f.dimension} (${f.detail})`).join("; ")
    );
  }
  if (input.roundsUsed >= MAX_AUTO_FIX_ROUNDS) {
    return `Still ${input.findings.length} finding(s) after ${MAX_AUTO_FIX_ROUNDS} auto-fix rounds; further rewriting would paper over them.`;
  }
  return `${input.findings.length} fixable finding(s); attempting round ${input.roundsUsed + 1}.`;
}
