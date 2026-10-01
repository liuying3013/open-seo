import { describe, expect, it } from "vitest";
import {
  BUSINESS_VALUE_WEIGHTS,
  DAILY_BUDGET_LIMITS,
  PLATFORM_SUITABILITY_WEIGHTS,
  formatBudgetUsage,
  marketPriorityScore,
  rankWeight,
  searchDemandScore,
  verdictForScore,
} from "./scoringRules";

describe("rankWeight", () => {
  it("is 1 at rank 1 and decays with depth", () => {
    expect(rankWeight(1)).toBe(1);
    expect(rankWeight(3)).toBeCloseTo(0.5, 5);
    expect(rankWeight(10)).toBeLessThan(rankWeight(3));
    expect(rankWeight(0)).toBe(0);
  });
});

describe("verdictForScore boundaries", () => {
  // Deliberately hardcoded: moving a threshold has to break this test, so the
  // change is a decision someone made rather than a number that drifted.
  it("maps the documented thresholds exactly", () => {
    expect(verdictForScore(65)).toBe("DEPLOY");
    expect(verdictForScore(64.9)).toBe("TEST");
    expect(verdictForScore(52)).toBe("TEST");
    expect(verdictForScore(51.9)).toBe("HOLD");
    expect(verdictForScore(42)).toBe("HOLD");
    expect(verdictForScore(41.9)).toBe("SKIP");
  });
});

describe("weight tables", () => {
  it("business value weights sum to 1", () => {
    const total = Object.values(BUSINESS_VALUE_WEIGHTS).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBeCloseTo(1, 10);
  });

  it("platform suitability weights sum to 1", () => {
    const total = Object.values(PLATFORM_SUITABILITY_WEIGHTS).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("subscore helpers", () => {
  it("marketPriorityScore maps 1..5 to 100..0", () => {
    expect(marketPriorityScore(1)).toBe(100);
    expect(marketPriorityScore(5)).toBe(0);
  });

  it("searchDemandScore is log-scaled and capped", () => {
    expect(searchDemandScore(null)).toBe(0);
    expect(searchDemandScore(100)).toBeCloseTo(50, 5);
    expect(searchDemandScore(1_000_000)).toBe(100);
  });
});

describe("daily budget limits", () => {
  it("does not cap brief generation", () => {
    expect(DAILY_BUDGET_LIMITS.briefsGenerated).toBeNull();
    expect(formatBudgetUsage(12, null)).toBe("12/unlimited");
    expect(formatBudgetUsage(12, 60)).toBe("12/60");
  });
});
