import { describe, expect, it } from "vitest";
import {
  computeCompetitorWeakness,
  computeConfidence,
  computeDemandScore,
  computeGapScore,
  computeOpportunityScore,
  computeSeoScalability,
  evaluateDemandGate,
  evaluateSerpGate,
  type ScorableOpportunityKeyword,
  type ScorableSerpResult,
} from "./computeScores";

const laneKeywords: ScorableOpportunityKeyword[] = [
  { role: "service", intent: "service", searchVolume: 0, cpc: 2 },
  { role: "commercial", intent: "commercial", searchVolume: null, cpc: null },
  { role: "info", intent: "informational", searchVolume: 0, cpc: null },
];

describe("computeDemandScore", () => {
  it("floors zero-volume but strongly commercial type-E opportunities (PRD §11)", () => {
    const result = computeDemandScore({
      type: "e_service_automation",
      keywords: laneKeywords,
    });
    expect(result.laneApplied).toBe(true);
    expect(result.score).toBe(40);
  });

  it("does not apply the lane outside type A/E", () => {
    const result = computeDemandScore({
      type: "b_ecosystem",
      keywords: laneKeywords,
    });
    expect(result.laneApplied).toBe(false);
    expect(result.score).toBe(26.7); // 0.4 * (2/3 * 100), no volume component
  });
});

describe("computeDemandScore buyer-role exclusion", () => {
  it("keeps a business customer's end-market volume out of our demand", () => {
    const withBuyerNoise = computeDemandScore({
      type: "c_hobby",
      keywords: [
        { role: "commercial", intent: "commercial", searchVolume: 100, cpc: 2 },
        // The end market of our customer, not our own buyers.
        { role: "buyer", intent: "service", searchVolume: 110000, cpc: 1 },
      ],
    });
    const withoutBuyer = computeDemandScore({
      type: "c_hobby",
      keywords: [
        { role: "commercial", intent: "commercial", searchVolume: 100, cpc: 2 },
      ],
    });
    expect(withBuyerNoise.score).toBe(withoutBuyer.score);
    expect(withBuyerNoise.breakdown.buyerRoleExcluded).toBe(1);
  });
});

const serpResults: ScorableSerpResult[] = [
  { rank: 1, resultType: "organic", pageClass: "supplier" },
  { rank: 2, resultType: "organic", pageClass: "forum_thread" },
];

describe("computeSeoScalability", () => {
  it("scores real queries, not the count of generated strings", () => {
    const role = "commercial" as const;
    const padded = Array.from({ length: 120 }, () => ({
      role,
      intent: "commercial",
      searchVolume: null,
      cpc: null,
    }));
    const real = Array.from({ length: 40 }, () => ({
      role,
      intent: "commercial",
      searchVolume: 50,
      cpc: 1,
    }));
    expect(computeSeoScalability(real)).toBeGreaterThan(
      computeSeoScalability(padded),
    );
  });
});

describe("computeGapScore", () => {
  it("uses page classes alone when the LLM pass has not run", () => {
    // rank weights 1 and 0.63093; gap weights 0 (supplier) and 1 (forum).
    expect(computeGapScore(serpResults, null)).toBe(38.7);
  });

  it("blends LLM gap signals when present", () => {
    const score = computeGapScore(serpResults, {
      intentMismatch: 1,
      weakDomainShare: 1,
      outdatedShare: 1,
    });
    expect(score).toBe(66.3); // 0.55 * 38.685 + 0.45 * 100
  });

  it("scores an empty SERP a neutral 50", () => {
    expect(computeGapScore([], null)).toBe(50);
  });
});

describe("computeCompetitorWeakness", () => {
  it("applies a conservative haircut without LLM signals", () => {
    // dedicated share 0.6131 -> (1 - share) * 0.8 * 100
    expect(computeCompetitorWeakness(serpResults, null)).toBe(30.9);
  });
});

describe("computeOpportunityScore", () => {
  it("renormalizes over the provided dimensions only", () => {
    const { score, breakdown } = computeOpportunityScore({
      dimensions: { commercialSearchDemand: 50, serpSupplyGap: 100 },
    });
    expect(score).toBe(80); // (50*10 + 100*15) / 25
    expect(breakdown.weightCovered).toBe(25);
    expect(breakdown.missingDimensions).toContain("buyerDensity");
  });

  it("clamps the LLM adjustment to ±8", () => {
    const { score, breakdown } = computeOpportunityScore({
      dimensions: { serpSupplyGap: 60 },
      llmAdjustment: 20,
    });
    expect(breakdown.llmAdjustment).toBe(8);
    expect(score).toBe(68);
  });
});

describe("computeConfidence", () => {
  it("reaches 100 only with full fresh evidence at the SERP stage", () => {
    expect(
      computeConfidence({
        keywordCount: 100,
        metricsCoveredShare: 1,
        serpPlanned: 5,
        serpFetched: 5,
        evidenceAgeDays: 10,
        stage: "serp",
      }),
    ).toBe(100);
  });

  it("stays low at the keyword stage with thin evidence", () => {
    expect(
      computeConfidence({
        keywordCount: 50,
        metricsCoveredShare: 0.5,
        serpPlanned: 0,
        serpFetched: 0,
        evidenceAgeDays: null,
        stage: "keyword",
      }),
    ).toBe(28.5);
  });
});

describe("gates", () => {
  it("demand gate routes advance / watchlist / reject by threshold", () => {
    expect(evaluateDemandGate(40).outcome).toBe("advance");
    expect(evaluateDemandGate(20).outcome).toBe("watchlist");
    expect(evaluateDemandGate(10).outcome).toBe("reject");
  });

  it("SERP gate never shortlists red IP risk", () => {
    expect(evaluateSerpGate({ score: 85, ipRisk: "green" }).outcome).toBe(
      "shortlist",
    );
    expect(evaluateSerpGate({ score: 85, ipRisk: "red" }).outcome).toBe(
      "watchlist",
    );
    expect(evaluateSerpGate({ score: 30, ipRisk: "green" }).outcome).toBe(
      "reject",
    );
  });
});
