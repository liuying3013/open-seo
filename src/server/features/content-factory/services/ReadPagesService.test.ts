import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clusterGetById: vi.fn(),
  serpGetLatestForCluster: vi.fn(),
  consume: vi.fn(),
  getFreshByUrls: vi.fn(),
  insertPage: vi.fn(),
  readPages: vi.fn(),
}));

vi.mock(
  "@/server/features/content-ops/repositories/ClustersRepository",
  () => ({
    ClustersRepository: { getById: mocks.clusterGetById },
  }),
);
vi.mock("@/server/features/content-ops/repositories/SerpRepository", () => ({
  SerpRepository: { getLatestForCluster: mocks.serpGetLatestForCluster },
}));
vi.mock("@/server/features/content-ops/services/BudgetService", () => ({
  BudgetService: { consume: mocks.consume },
}));
vi.mock("../repositories/ResearchPagesRepository", () => ({
  ResearchPagesRepository: {
    getFreshByUrls: mocks.getFreshByUrls,
    insertPage: mocks.insertPage,
  },
}));
vi.mock("@/server/lib/scrape", () => ({ readPages: mocks.readPages }));

import { ReadPagesService } from "./ReadPagesService";

function serpResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "result-1",
    rank: 1,
    url: "https://competitor.com/guide",
    domain: "competitor.com",
    resultType: "organic",
    isOwned: false,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.clusterGetById.mockResolvedValue({
    id: "cluster-1",
    status: "decided",
  });
  mocks.serpGetLatestForCluster.mockResolvedValue([
    { snapshot: { id: "snap-1" }, results: [serpResult()] },
  ]);
  mocks.getFreshByUrls.mockResolvedValue(new Map());
  mocks.insertPage.mockResolvedValue("page-1");
  mocks.readPages.mockResolvedValue({
    pages: [
      {
        url: "https://competitor.com/guide",
        title: "Guide",
        text: "body text here",
      },
    ],
    blocked: false,
  });
});

describe("ReadPagesService.readClusterPages", () => {
  it("refuses to read before the deployment decision is approved", async () => {
    mocks.clusterGetById.mockResolvedValue({
      id: "cluster-1",
      status: "serp_ready",
    });

    await expect(
      ReadPagesService.readClusterPages({
        projectId: "project-1",
        clusterId: "cluster-1",
      }),
    ).rejects.toMatchObject({ code: "DECISION_NOT_APPROVED" });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.readPages).not.toHaveBeenCalled();
  });

  it("reuses a fresh body without spending budget", async () => {
    mocks.getFreshByUrls.mockResolvedValue(
      new Map([
        [
          "https://competitor.com/guide",
          {
            url: "https://competitor.com/guide",
            clusterId: "cluster-1",
            wordCount: 120,
          },
        ],
      ]),
    );

    const result = await ReadPagesService.readClusterPages({
      projectId: "project-1",
      clusterId: "cluster-1",
    });

    expect(result.outcomes).toEqual([
      expect.objectContaining({ status: "reused", wordCount: 120 }),
    ]);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.readPages).not.toHaveBeenCalled();
  });

  it("associates another cluster's cached evidence without renewing freshness", async () => {
    const cached = {
      id: "original-page",
      projectId: "project-1",
      clusterId: "other-cluster",
      serpResultId: "old-result",
      url: "https://competitor.com/guide",
      domain: "competitor.com",
      fetchMethod: "read_pages",
      fetchStatus: "ok",
      httpStatus: 200,
      title: "Guide",
      bodyText: "Previously read evidence",
      objectKey: null,
      contentHash: "original-hash",
      wordCount: 3,
      fetchedAt: "2026-09-10T00:00:00.000Z",
    };
    mocks.getFreshByUrls.mockResolvedValue(new Map([[cached.url, cached]]));
    await ReadPagesService.readClusterPages({
      projectId: "project-1",
      clusterId: "cluster-1",
    });
    expect(mocks.insertPage).toHaveBeenCalledWith({
      projectId: "project-1",
      clusterId: "cluster-1",
      serpResultId: "result-1",
      url: cached.url,
      domain: cached.domain,
      fetchMethod: cached.fetchMethod,
      fetchStatus: cached.fetchStatus,
      httpStatus: cached.httpStatus,
      title: cached.title,
      bodyText: cached.bodyText,
      objectKey: cached.objectKey,
      contentHash: cached.contentHash,
      wordCount: cached.wordCount,
      fetchedAt: cached.fetchedAt,
    });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.readPages).not.toHaveBeenCalled();
  });

  // The anti-hallucination guarantee: an unreadable page is persisted as a
  // failed attempt and surfaced as an open question, never dropped so the
  // model can fill the gap from a title.
  it("persists an unreadable page and raises it as an open question", async () => {
    mocks.readPages.mockResolvedValue({ pages: [], blocked: true });

    const result = await ReadPagesService.readClusterPages({
      projectId: "project-1",
      clusterId: "cluster-1",
    });

    expect(mocks.insertPage).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://competitor.com/guide",
        fetchStatus: "blocked",
        bodyText: null,
      }),
    );
    expect(result.outcomes).toEqual([
      expect.objectContaining({ status: "blocked" }),
    ]);
    expect(result.openQuestions).toHaveLength(1);
  });

  it("skips our own pages and unreadable result types", async () => {
    mocks.serpGetLatestForCluster.mockResolvedValue([
      {
        snapshot: { id: "snap-1" },
        results: [
          serpResult({ id: "r1", url: "https://ours.com/p", isOwned: true }),
          serpResult({
            id: "r2",
            url: "https://x.com/paa",
            resultType: "people_also_ask",
          }),
        ],
      },
    ]);

    await expect(
      ReadPagesService.readClusterPages({
        projectId: "project-1",
        clusterId: "cluster-1",
      }),
    ).rejects.toMatchObject({ code: "NO_PAGES_TO_READ" });
  });
});
