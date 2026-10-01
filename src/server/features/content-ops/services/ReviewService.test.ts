import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decisionGetById: vi.fn(),
  decisionTransitionStatus: vi.fn(),
  assetInsertMany: vi.fn(),
  clusterGetById: vi.fn(),
  clusterTransitionStatus: vi.fn(),
  appendLog: vi.fn(),
}));

vi.mock("../repositories/DecisionsRepository", () => ({
  DecisionsRepository: {
    getById: mocks.decisionGetById,
    transitionStatus: mocks.decisionTransitionStatus,
  },
}));
vi.mock("../repositories/AssetsRepository", () => ({
  AssetsRepository: { insertMany: mocks.assetInsertMany },
}));
vi.mock("../repositories/ClustersRepository", () => ({
  ClustersRepository: {
    getById: mocks.clusterGetById,
    transitionStatus: mocks.clusterTransitionStatus,
  },
}));
vi.mock("../repositories/DecisionLogRepository", () => ({
  DecisionLogRepository: { append: mocks.appendLog },
}));
import { ReviewService } from "./ReviewService";

const baseDecision = {
  id: "decision-1",
  projectId: "project-1",
  clusterId: "cluster-1",
  status: "proposed" as const,
  moneySitePageType: "guide",
  platformPlan: JSON.stringify([
    {
      platform: "youtube",
      verdict: "TEST",
      score: 60,
      subscores: { intentFit: 60 },
    },
  ]),
  reasonSummary: "test",
  decidedBy: "agent" as const,
  approvedAt: null,
  supersededById: null,
  createdAt: "2026-09-01T00:00:00.000Z",
};

beforeEach(() => {
  mocks.assetInsertMany.mockResolvedValue(["asset-1", "asset-2"]);
  mocks.clusterGetById.mockResolvedValue({
    id: "cluster-1",
    status: "decided",
  });
});

describe("ReviewService approval concurrency", () => {
  it("reconciles assets from the winning persisted approval after losing the status race", async () => {
    mocks.decisionGetById
      .mockResolvedValueOnce(baseDecision)
      .mockResolvedValueOnce({ ...baseDecision, status: "approved" });
    mocks.decisionTransitionStatus.mockResolvedValue(false);
    await expect(
      ReviewService.reviewDecision({
        projectId: "project-1",
        decisionId: "decision-1",
        action: "approve",
      }),
    ).resolves.toEqual({
      status: "approved",
      assetIds: ["asset-1", "asset-2"],
    });
    expect(mocks.assetInsertMany).toHaveBeenCalledWith([
      expect.objectContaining({ platform: "money_site" }),
      expect.objectContaining({ platform: "youtube" }),
    ]);
    expect(mocks.appendLog).not.toHaveBeenCalled();
  });

  it("rejects an unknown persisted platform before changing state", async () => {
    mocks.decisionGetById.mockResolvedValue({
      ...baseDecision,
      platformPlan: JSON.stringify([
        {
          platform: "invented-network",
          verdict: "DEPLOY",
          score: 80,
          subscores: {},
        },
      ]),
    });
    await expect(
      ReviewService.reviewDecision({
        projectId: "project-1",
        decisionId: "decision-1",
        action: "approve",
      }),
    ).rejects.toThrow();
    expect(mocks.decisionTransitionStatus).not.toHaveBeenCalled();
    expect(mocks.assetInsertMany).not.toHaveBeenCalled();
  });
});
