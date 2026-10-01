import { describe, expect, it } from "vitest";
import {
  explainVerdict,
  isAutoFixable,
  MAX_AUTO_FIX_ROUNDS,
  verdictFor,
  type QaFinding,
} from "./qaRules";

const finding = (over: Partial<QaFinding> = {}): QaFinding => ({
  dimension: "expression_quality",
  severity: "fix",
  detail: "padding in the opening",
  ...over,
});

describe("isAutoFixable", () => {
  // Asking a model to "fix" an unsourced claim asks it to invent a source.
  it("never lets a rewrite touch grounding, boundary or duplication", () => {
    for (const dimension of [
      "factual_grounding",
      "project_boundary",
      "duplicate_content",
    ] as const) {
      expect(isAutoFixable(finding({ dimension }))).toBe(false);
    }
  });

  it("allows a rewrite at wording, coverage and technical problems", () => {
    for (const dimension of [
      "answers_the_query",
      "expression_quality",
      "technical_requirements",
    ] as const) {
      expect(isAutoFixable(finding({ dimension }))).toBe(true);
    }
  });

  it("never auto-fixes a blocker, whatever its dimension", () => {
    expect(
      isAutoFixable(
        finding({ dimension: "expression_quality", severity: "blocker" }),
      ),
    ).toBe(false);
  });
});

describe("verdictFor", () => {
  it("passes a clean draft", () => {
    expect(verdictFor({ findings: [], roundsUsed: 0 })).toBe("pass");
  });

  it("sends one unfixable finding to a human even beside fixable ones", () => {
    expect(
      verdictFor({
        findings: [finding(), finding({ dimension: "factual_grounding" })],
        roundsUsed: 0,
      }),
    ).toBe("human_review");
  });

  // The third rewrite is where a model stops fixing and starts rephrasing.
  it("escalates instead of rewriting forever", () => {
    expect(
      verdictFor({ findings: [finding()], roundsUsed: MAX_AUTO_FIX_ROUNDS }),
    ).toBe("human_review");
    expect(
      verdictFor({
        findings: [finding()],
        roundsUsed: MAX_AUTO_FIX_ROUNDS - 1,
      }),
    ).toBe("auto_fix");
  });
});

describe("explainVerdict", () => {
  it("names the findings a rewrite cannot fix", () => {
    const text = explainVerdict({
      verdict: "human_review",
      findings: [
        finding({
          dimension: "factual_grounding",
          detail: "no source for R50",
        }),
      ],
      roundsUsed: 0,
    });
    expect(text).toContain("factual_grounding");
    expect(text).toContain("no source for R50");
  });

  it("says when rounds ran out rather than blaming the content", () => {
    const text = explainVerdict({
      verdict: "human_review",
      findings: [finding()],
      roundsUsed: MAX_AUTO_FIX_ROUNDS,
    });
    expect(text).toContain("auto-fix rounds");
  });
});
