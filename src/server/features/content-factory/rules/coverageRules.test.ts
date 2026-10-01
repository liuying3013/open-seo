import { describe, expect, it } from "vitest";
import { classifyCoverage, type CoveragePage } from "./coverageRules";

const page = (over: Partial<CoveragePage>): CoveragePage => ({
  url: "https://ours.com/a",
  title: "A page",
  wordCount: 1200,
  internalLinkCount: 5,
  isIndexable: true,
  overlap: 3,
  ...over,
});

describe("classifyCoverage", () => {
  it("says new when nothing of ours clears the overlap threshold", () => {
    expect(classifyCoverage([page({ overlap: 1 })]).verdict).toBe("new");
    expect(classifyCoverage([]).verdict).toBe("new");
  });

  // Two of our own pages competing for one query is cannibalization, and
  // consolidating them is not a writing task.
  it("proposes a merge for two covering pages and demands confirmation", () => {
    const decision = classifyCoverage([
      page({ url: "https://ours.com/a" }),
      page({ url: "https://ours.com/b" }),
    ]);
    expect(decision.verdict).toBe("merge");
    expect(decision.requiresHumanConfirmation).toBe(true);
    expect(decision.pages).toHaveLength(2);
  });

  it("never asks for confirmation on the branches that only write", () => {
    for (const verdict of [
      classifyCoverage([]),
      classifyCoverage([page({ wordCount: 100 })]),
      classifyCoverage([page({ internalLinkCount: 0 })]),
      classifyCoverage([page({})]),
    ]) {
      if (verdict.verdict !== "merge") {
        expect(verdict.requiresHumanConfirmation).toBe(false);
      }
    }
  });

  it("updates a thin or unindexable page rather than optimizing it", () => {
    expect(classifyCoverage([page({ wordCount: 100 })]).verdict).toBe("update");
    expect(classifyCoverage([page({ isIndexable: false })]).verdict).toBe(
      "update",
    );
  });

  // Good copy nothing links to is an internal-linking problem, not a rewrite.
  it("optimizes a deep page that is nearly orphaned", () => {
    expect(classifyCoverage([page({ internalLinkCount: 0 })]).verdict).toBe(
      "optimize",
    );
  });

  it("skips a page that is indexable, deep enough and linked", () => {
    expect(classifyCoverage([page({})]).verdict).toBe("skip");
  });
});
