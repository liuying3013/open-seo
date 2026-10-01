import { describe, expect, it } from "vitest";
import { isActionable, scoreTask, type TaskPoolInputs } from "./taskPoolRules";

const task = (over: Partial<TaskPoolInputs> = {}): TaskPoolInputs => ({
  projectName: "HeyMaterials",
  clusterName: "flexible stone panels",
  businessValue: 60,
  coverageVerdict: "new",
  hasSerpSnapshots: false,
  hasReadPages: false,
  pendingSerpFetches: 3,
  ...over,
});

describe("scoreTask", () => {
  // The whole point of this model over a bare business-value sort: evidence we
  // already paid for makes a task cheaper and therefore more attractive.
  it("ranks a task whose evidence is already bought above an identical one without it", () => {
    const ready = scoreTask(
      task({
        hasSerpSnapshots: true,
        hasReadPages: true,
        pendingSerpFetches: 0,
      }),
    );
    const cold = scoreTask(task());
    expect(ready.score).toBeGreaterThan(cold.score);
  });

  // Optimizing a page that exists and is orphaned is the cheapest real win.
  it("puts optimize above new at equal business value", () => {
    expect(
      scoreTask(task({ coverageVerdict: "optimize" })).score,
    ).toBeGreaterThan(scoreTask(task({ coverageVerdict: "new" })).score);
  });

  it("explains itself in words, not just a number", () => {
    const scored = scoreTask(task({ coverageVerdict: "update" }));
    expect(scored.reason).toContain("HeyMaterials");
    expect(scored.reason).toContain("thin or unindexable");
    expect(scored.reason).toContain("no SERP evidence is stored yet");
  });

  it("treats an unscored cluster as zero business value and says so", () => {
    const scored = scoreTask(task({ businessValue: null }));
    expect(scored.subscores.businessValue).toBe(0);
    expect(scored.reason).toContain("unscored");
  });
});

describe("isActionable", () => {
  it("drops skip and keeps everything that produces work", () => {
    expect(isActionable("skip")).toBe(false);
    for (const verdict of ["new", "update", "optimize", "merge"] as const) {
      expect(isActionable(verdict)).toBe(true);
    }
  });
});
