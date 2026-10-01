import { describe, expect, it } from "vitest";
import {
  blocksApprovalAsSelfCitation,
  independentSourceCount,
  isStale,
  isUsableInWriting,
  normalizeStatement,
  recheckAfterFor,
} from "./knowledgeRules";

describe("normalizeStatement", () => {
  it("collapses case, punctuation and spacing so restatements dedupe", () => {
    expect(normalizeStatement("MCM panels bend to R50.")).toBe(
      normalizeStatement("  mcm  panels bend to r50  "),
    );
  });

  // No stemming on purpose: a singular/plural difference should be a human
  // merge decision, not a silent one.
  it("keeps singular and plural apart", () => {
    expect(normalizeStatement("panel is 3mm")).not.toBe(
      normalizeStatement("panels are 3mm"),
    );
  });
});

describe("gate (c): independent source counting", () => {
  it("counts every independent source", () => {
    expect(
      independentSourceCount([
        { isIndependent: true, isOwnContent: false },
        { isIndependent: true, isOwnContent: false },
      ]),
    ).toBe(2);
  });

  // Five copies of one press release are one source, not five.
  it("collapses all syndicated copies into a single source", () => {
    expect(
      independentSourceCount([
        { isIndependent: true, isOwnContent: false },
        { isIndependent: false, isOwnContent: false },
        { isIndependent: false, isOwnContent: false },
        { isIndependent: false, isOwnContent: false },
      ]),
    ).toBe(2);
  });
});

describe("gate (b): self-citation ban", () => {
  it("blocks a fact sourced only to our own content", () => {
    expect(
      blocksApprovalAsSelfCitation({
        claimType: "fact",
        sources: [
          { isIndependent: true, isOwnContent: true },
          { isIndependent: true, isOwnContent: true },
        ],
      }),
    ).toBe(true);
  });

  it("allows a fact once one source is not ours", () => {
    expect(
      blocksApprovalAsSelfCitation({
        claimType: "fact",
        sources: [
          { isIndependent: true, isOwnContent: true },
          { isIndependent: true, isOwnContent: false },
        ],
      }),
    ).toBe(false);
  });

  it("blocks a fact with no sources at all", () => {
    expect(
      blocksApprovalAsSelfCitation({ claimType: "fact", sources: [] }),
    ).toBe(true);
  });

  // "Our guide takes this angle" is legitimately sourced to our own page.
  it("does not apply to judgments, observations or hypotheses", () => {
    for (const claimType of [
      "judgment",
      "observation",
      "hypothesis",
    ] as const) {
      expect(
        blocksApprovalAsSelfCitation({
          claimType,
          sources: [{ isIndependent: true, isOwnContent: true }],
        }),
      ).toBe(false);
    }
  });
});

describe("gate (a): what may enter a writing context", () => {
  it("admits only approved and public entries", () => {
    expect(isUsableInWriting({ status: "approved", scope: "public" })).toBe(
      true,
    );
    expect(isUsableInWriting({ status: "approved", scope: "internal" })).toBe(
      false,
    );
    for (const status of [
      "candidate",
      "needs_review",
      "superseded",
      "retracted",
    ] as const) {
      expect(isUsableInWriting({ status, scope: "public" })).toBe(false);
    }
  });
});

describe("staleness", () => {
  it("ages a SERP observation far faster than an editorial lesson", () => {
    const from = "2026-01-01T00:00:00.000Z";
    expect(
      recheckAfterFor("serp_observation", from) <
        recheckAfterFor("editorial_lesson", from),
    ).toBe(true);
  });

  it("treats a passed recheck date as stale and a null as never stale", () => {
    const now = "2026-06-01T00:00:00.000Z";
    expect(isStale({ recheckAfter: "2026-05-31T00:00:00.000Z" }, now)).toBe(
      true,
    );
    expect(isStale({ recheckAfter: "2026-07-01T00:00:00.000Z" }, now)).toBe(
      false,
    );
    expect(isStale({ recheckAfter: null }, now)).toBe(false);
  });
});
