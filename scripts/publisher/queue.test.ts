import { describe, expect, it } from "vitest";
import type { PublishItem, PublishQueue } from "./openseo-client";
import { planRun } from "./queue";

const item = (overrides: Partial<PublishItem>): PublishItem => ({
  assetId: "a1",
  approvalId: "ap1",
  versionId: "v1",
  version: 1,
  approvedPatchId: "abc",
  taskBranch: "task/a1",
  draft: { title: "T", body: "B" },
  activeAttempt: null,
  failedAttempts: 0,
  ...overrides,
});

describe("planRun", () => {
  it("publishes only entries without an in-flight, failed or already-pushed attempt", () => {
    const queue: PublishQueue = {
      publish: [
        item({ assetId: "ok", approvalId: "ap-ok" }),
        item({
          assetId: "busy",
          approvalId: "ap-busy",
          activeAttempt: { id: "x", status: "deploying" },
        }),
        item({ assetId: "failed", approvalId: "ap-failed", failedAttempts: 1 }),
        item({ assetId: "pushed", approvalId: "ap-pushed" }),
        item({ assetId: "rb", approvalId: "ap-rb" }),
      ],
      rollbacks: [{ attemptId: "r1", assetId: "rb", mergeCommit: "deadbeef" }],
    };
    const plan = planRun(queue, new Set(["ap-pushed"]));
    expect(plan.publish.map((entry) => entry.assetId)).toEqual(["ok"]);
    expect(plan.rollbacks).toHaveLength(1);
    expect(plan.skipped.map((entry) => entry.assetId)).toEqual([
      "busy",
      "failed",
      "pushed",
      "rb",
    ]);
  });
});
