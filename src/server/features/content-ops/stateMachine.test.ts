import { describe, expect, it } from "vitest";
import { ContentOpsError } from "./contentOpsErrors";
import { assertAssetTransition, assertClusterTransition } from "./stateMachine";

describe("cluster state machine", () => {
  it("allows the happy path end to end", () => {
    const path = [
      "new",
      "pre_scored",
      "serp_pending",
      "serp_ready",
      "scored",
      "decided",
      "brief_ready",
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => assertClusterTransition(path[i], path[i + 1])).not.toThrow();
    }
  });

  it("rejects skipping the SERP stage (the disambiguation/evidence guard)", () => {
    expect(() => assertClusterTransition("pre_scored", "scored")).toThrow(
      ContentOpsError,
    );
    expect(() => assertClusterTransition("new", "decided")).toThrow(
      ContentOpsError,
    );
  });

  it("treats archived as terminal", () => {
    expect(() => assertClusterTransition("archived", "new")).toThrow(
      ContentOpsError,
    );
  });
});

describe("asset state machine", () => {
  it("allows the MVP path and the redo loop", () => {
    expect(() => assertAssetTransition("planned", "brief_ready")).not.toThrow();
    expect(() => assertAssetTransition("brief_ready", "planned")).not.toThrow();
  });

  it("rejects publishing straight from planned", () => {
    expect(() => assertAssetTransition("planned", "published")).toThrow(
      ContentOpsError,
    );
  });
});
