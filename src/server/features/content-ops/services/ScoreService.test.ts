import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clusterGetById: vi.fn(),
  getKeywords: vi.fn(),
  updateScores:
    vi.fn<(id: string, update: { offerId?: string | null }) => Promise<void>>(),
  transitionStatus: vi.fn(),
  offerGetById: vi.fn(),
  appendLog: vi.fn(),
}));

vi.mock("../repositories/ClustersRepository", () => ({
  ClustersRepository: {
    getById: mocks.clusterGetById,
    getKeywords: mocks.getKeywords,
    updateScores: mocks.updateScores,
    transitionStatus: mocks.transitionStatus,
  },
}));
vi.mock("../repositories/OffersRepository", () => ({
  OffersRepository: { getById: mocks.offerGetById },
}));
vi.mock("../repositories/DecisionLogRepository", () => ({
  DecisionLogRepository: { append: mocks.appendLog },
}));

import { ScoreService } from "./ScoreService";

const judgment = {
  purchaseProximity: 50,
  conversionReadiness: 50,
  coreRelevance: 50,
};

beforeEach(() => {
  mocks.clusterGetById.mockResolvedValue({
    id: "cluster-1",
    projectId: "project-1",
    status: "scored",
    entityCategory: "MCM",
    offerId: null,
  });
  mocks.getKeywords.mockResolvedValue([]);
  mocks.offerGetById.mockResolvedValue({
    id: "offer-1",
    name: "Architectural",
    marginTier: "high",
    readiness: "ready",
    marketPriority: 1,
  });
});

describe("ScoreService.scoreBusinessValue", () => {
  // Clusters saved without an offer used to be stuck at zero on the offer
  // subscores with no tool able to link one afterwards.
  it("links the offer given at scoring time and scores with it", async () => {
    const { score } = await ScoreService.scoreBusinessValue({
      projectId: "project-1",
      clusterId: "cluster-1",
      agent: judgment,
      offerId: "offer-1",
      createdBy: "agent",
    });

    expect(mocks.offerGetById).toHaveBeenCalledWith("project-1", "offer-1");
    expect(mocks.updateScores.mock.calls[0][1].offerId).toBe("offer-1");
    expect(score).toBeGreaterThan(50);
  });

  it("rejects an offer the project does not have instead of silently scoring without one", async () => {
    mocks.offerGetById.mockResolvedValue(null);

    await expect(
      ScoreService.scoreBusinessValue({
        projectId: "project-1",
        clusterId: "cluster-1",
        agent: judgment,
        offerId: "missing",
        createdBy: "agent",
      }),
    ).rejects.toMatchObject({ code: "OFFER_NOT_FOUND" });
    expect(mocks.updateScores).not.toHaveBeenCalled();
  });
});
