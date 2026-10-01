import { describe, expect, it } from "vitest";
import {
  computeBusinessValue,
  computePlatformPlan,
  computeSerpScores,
  decideMoneySitePageType,
  deriveIntentVector,
} from "./computeScores";
import { THIRD_PARTY_PLATFORMS, type ThirdPartyPlatform } from "./scoringRules";

/**
 * Acceptance for every platform, named ones overridden. Built from the
 * platform list rather than spelled out, so adding a platform does not break
 * unrelated assertions.
 */
function acceptance(
  overrides: Partial<Record<ThirdPartyPlatform, number>>,
  fill = 0,
): Record<ThirdPartyPlatform, number> {
  return Object.fromEntries(
    THIRD_PARTY_PLATFORMS.map((platform) => [
      platform,
      overrides[platform] ?? fill,
    ]),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- keys enumerated from THIRD_PARTY_PLATFORMS
  ) as Record<ThirdPartyPlatform, number>;
}

const organic = (
  rank: number,
  contentType: string | null,
  platform: string | null = null,
) => ({
  rank,
  resultType: "organic",
  platform,
  contentType,
});

describe("computeSerpScores", () => {
  it("weights higher ranks more and normalizes to shares", () => {
    const { formatScores } = computeSerpScores([
      organic(1, "guide"),
      organic(10, "product"),
    ]);
    expect(formatScores.guide).toBeGreaterThan(formatScores.product);
    expect(formatScores.guide + formatScores.product).toBeCloseTo(1, 10);
  });

  it("attributes platform rows and video results to platform acceptance", () => {
    const { platformAcceptance } = computeSerpScores([
      organic(1, "guide"),
      organic(2, "forum_thread", "reddit"),
      {
        rank: 4,
        resultType: "video",
        platform: "youtube",
        contentType: "video",
      },
    ]);
    expect(platformAcceptance.reddit).toBeGreaterThan(0);
    expect(platformAcceptance.youtube).toBeGreaterThan(0);
    expect(platformAcceptance.medium).toBe(0);
  });

  // A recognized platform must never fall through to the "video means
  // YouTube" default; that is what credited Facebook and Instagram video
  // carousels to YouTube before content-ops-v2.
  it("credits a video to its own platform, not YouTube", () => {
    const { platformAcceptance } = computeSerpScores([
      { rank: 1, resultType: "video", platform: "facebook", contentType: null },
      {
        rank: 2,
        resultType: "video",
        platform: "instagram",
        contentType: null,
      },
    ]);
    expect(platformAcceptance.facebook).toBeGreaterThan(0);
    expect(platformAcceptance.instagram).toBeGreaterThan(0);
    expect(platformAcceptance.youtube).toBe(0);
  });

  // tiktok is mapped by the domain table but is not a platform we deploy to;
  // its rows must not be silently credited to anyone.
  it("gives a non-deployable platform's row to nobody", () => {
    const { platformAcceptance } = computeSerpScores([
      { rank: 1, resultType: "video", platform: "tiktok", contentType: null },
    ]);
    for (const value of Object.values(platformAcceptance)) {
      expect(value).toBe(0);
    }
  });
});

describe("deriveIntentVector", () => {
  it("maps guide-heavy SERPs to informational and normalizes to 1", () => {
    const vector = deriveIntentVector({ guide: 0.8, product: 0.2 });
    expect(vector.informational).toBeGreaterThan(vector.transactional);
    const sum =
      vector.informational +
      vector.commercial +
      vector.transactional +
      vector.navigational;
    expect(sum).toBeCloseTo(1, 10);
  });

  it("defaults to informational on an empty SERP", () => {
    expect(deriveIntentVector({}).informational).toBe(1);
  });
});

describe("computeBusinessValue", () => {
  const agent = {
    purchaseProximity: 80,
    conversionReadiness: 60,
    coreRelevance: 100,
  };

  it("scores a ready high-margin offer far above a missing offer", () => {
    const withOffer = computeBusinessValue({
      offer: { marginTier: "high", readiness: "ready", marketPriority: 1 },
      agent,
      monthlyVolume: 100,
    });
    const withoutOffer = computeBusinessValue({
      offer: null,
      agent,
      monthlyVolume: 100,
    });
    expect(withOffer.score).toBeGreaterThan(withoutOffer.score + 30);
  });

  it("volume alone cannot dominate: max search demand adds at most 5 points", () => {
    const base = computeBusinessValue({
      offer: null,
      agent: { purchaseProximity: 0, conversionReadiness: 0, coreRelevance: 0 },
      monthlyVolume: null,
    });
    const hugeVolume = computeBusinessValue({
      offer: null,
      agent: { purchaseProximity: 0, conversionReadiness: 0, coreRelevance: 0 },
      monthlyVolume: 1_000_000,
    });
    expect(hugeVolume.score - base.score).toBeLessThanOrEqual(5);
  });
});

describe("computePlatformPlan", () => {
  it("applies the standing risk penalty to reddit/quora", () => {
    const plan = computePlatformPlan({
      platformAcceptance: acceptance({}, 0.3),
      userJob: "compare",
    });
    const reddit = plan.find((p) => p.platform === "reddit")!;
    expect(reddit.subscores.riskPenalty).toBe(15);
    // Same acceptance + same job fit would otherwise score reddit ~equal to
    // medium (compare: reddit 0.8 fit vs medium 0.7); the penalty flips it.
    const medium = plan.find((p) => p.platform === "medium")!;
    expect(reddit.score).toBeLessThan(medium.score);
  });

  it("high acceptance + strong fit reaches DEPLOY, zero acceptance holds back", () => {
    const strong = computePlatformPlan({
      platformAcceptance: acceptance({ youtube: 0.9 }),
      userJob: "troubleshoot",
      brandNaturalness: { youtube: 90 },
      evidenceReadiness: 90,
    });
    expect(strong.find((p) => p.platform === "youtube")!.verdict).toBe(
      "DEPLOY",
    );
    expect(["HOLD", "SKIP"]).toContain(
      strong.find((p) => p.platform === "pinterest")!.verdict,
    );
  });
});

describe("decideMoneySitePageType", () => {
  it("prefers comparison when comparisons hold >=20% of the SERP", () => {
    expect(
      decideMoneySitePageType({
        formatScores: { comparison: 0.25, guide: 0.5 },
        intentVector: {
          informational: 0.5,
          commercial: 0.4,
          transactional: 0.1,
          navigational: 0,
        },
      }).pageType,
    ).toBe("comparison");
  });

  it("falls back to guide for informational SERPs", () => {
    expect(
      decideMoneySitePageType({
        formatScores: { guide: 0.7, qna: 0.1 },
        intentVector: {
          informational: 0.9,
          commercial: 0.1,
          transactional: 0,
          navigational: 0,
        },
      }).pageType,
    ).toBe("guide");
  });
});
