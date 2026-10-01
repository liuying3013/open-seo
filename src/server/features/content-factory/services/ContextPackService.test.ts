import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectContext: vi.fn(),
  getCluster: vi.fn(),
  getKeywords: vi.fn(),
  listUsableForWriting: vi.fn(),
  getLatestForCluster: vi.fn(),
  listByCluster: vi.fn(),
  listOpenConflicts: vi.fn(),
}));

vi.mock(
  "@/server/features/project-context/services/ProjectContextService",
  () => ({ getProjectContext: mocks.getProjectContext }),
);
vi.mock(
  "@/server/features/content-ops/repositories/ClustersRepository",
  () => ({
    ClustersRepository: {
      getById: mocks.getCluster,
      getKeywords: mocks.getKeywords,
    },
  }),
);
vi.mock("@/server/features/content-ops/repositories/AssetsRepository", () => ({
  AssetsRepository: { listByCluster: mocks.listByCluster },
}));
vi.mock("../repositories/KnowledgeRepository", () => ({
  KnowledgeRepository: {
    listUsableForWriting: mocks.listUsableForWriting,
    listOpenConflicts: mocks.listOpenConflicts,
  },
}));
vi.mock("../repositories/ResearchPagesRepository", () => ({
  ResearchPagesRepository: { getLatestForCluster: mocks.getLatestForCluster },
}));

import { ContextPackService } from "./ContextPackService";

const entry = (over: Record<string, unknown>) => ({
  id: "k",
  statement: "",
  claimType: "fact",
  category: "verified_fact",
  entity: null,
  applicability: null,
  recheckAfter: "2999-01-01T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  mocks.getCluster.mockResolvedValue({
    id: "c1",
    name: "flexible stone panels",
    primaryEntity: "MCM",
    userJob: "choose",
    entityCategory: "MCM",
  });
  mocks.getKeywords.mockResolvedValue([{ keyword: "flexible stone panel" }]);
  mocks.getProjectContext.mockResolvedValue({
    sections: [{ key: "business_overview", content: "we sell MCM" }],
    customSections: [],
    competitors: [{ domain: "stone-flex.com" }],
    keyPages: [],
    researchLog: [],
  });
  mocks.listUsableForWriting.mockResolvedValue([]);
  mocks.getLatestForCluster.mockResolvedValue([]);
  mocks.listByCluster.mockResolvedValue([]);
  mocks.listOpenConflicts.mockResolvedValue([]);
});

describe("ContextPackService.buildForCluster", () => {
  // The output rule that matters most: three buckets, never merged.
  it("separates settled knowledge from stale knowledge", async () => {
    mocks.listUsableForWriting.mockResolvedValue([
      entry({ id: "fresh", statement: "flexible stone panels bend to R50" }),
      entry({
        id: "old",
        statement: "flexible stone panel price is $12",
        recheckAfter: "2000-01-01T00:00:00.000Z",
      }),
    ]);

    const pack = await ContextPackService.buildForCluster({
      projectId: "p1",
      clusterId: "c1",
    });

    expect(pack.known.map((k) => k.id)).toEqual(["fresh"]);
    expect(pack.possiblyStale.map((k) => k.id)).toEqual(["old"]);
  });

  // Layer 2 is retrieved, not dumped: an unrelated claim must not ride along.
  it("leaves knowledge with no term overlap out of the pack", async () => {
    mocks.listUsableForWriting.mockResolvedValue([
      entry({ id: "related", statement: "flexible stone bends" }),
      entry({
        id: "unrelated",
        statement: "helmet cleaning machines cost more",
      }),
    ]);

    const pack = await ContextPackService.buildForCluster({
      projectId: "p1",
      clusterId: "c1",
    });

    expect([...pack.known, ...pack.possiblyStale].map((k) => k.id)).toEqual([
      "related",
    ]);
  });

  // An unreadable page is an open question, not an absence.
  it("turns unreadable pages and open conflicts into open questions", async () => {
    mocks.getLatestForCluster.mockResolvedValue([
      { url: "https://blocked.com/x", fetchStatus: "blocked" },
      { url: "https://ok.com/y", fetchStatus: "ok" },
    ]);
    mocks.listOpenConflicts.mockResolvedValue([
      { detail: "two thicknesses reported", kind: "value_mismatch" },
    ]);

    const pack = await ContextPackService.buildForCluster({
      projectId: "p1",
      clusterId: "c1",
    });

    expect(pack.openQuestions).toHaveLength(2);
    expect(pack.openQuestions[0]).toContain("blocked.com");
    expect(pack.openQuestions.join(" ")).not.toContain("ok.com");
  });

  // Layer 1 is loaded whole every time, not retrieved by relevance: a product
  // boundary that only loads "when relevant" is how a task writes about a
  // category the business does not stock.
  it("always carries the project rules", async () => {
    const pack = await ContextPackService.buildForCluster({
      projectId: "p1",
      clusterId: "c1",
    });

    expect(pack.rules.businessOverview).toBe("we sell MCM");
    expect(pack.rules.competitors).toEqual(["stone-flex.com"]);
  });
});
