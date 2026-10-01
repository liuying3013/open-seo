import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clusterGetById: vi.fn(),
  getKeywords: vi.fn(),
  serpGetLatestForCluster: vi.fn(),
  listByCluster: vi.fn(),
  getProjectContext: vi.fn(),
  offersGetById: vi.fn(),
  researchGetLatestForCluster: vi.fn(),
  listForWriting: vi.fn(),
  // Typed so the assertions below can read the recorded call arguments without
  // going through `any`.
  runStructuredLlm: vi.fn<(input: { prompt: string }) => Promise<unknown>>(),
  insertVersion: vi.fn(),
  appendLog: vi.fn<(input: { inputSnapshot: string }) => Promise<unknown>>(),
}));

vi.mock("../repositories/ClustersRepository", () => ({
  ClustersRepository: {
    getById: mocks.clusterGetById,
    getKeywords: mocks.getKeywords,
  },
}));
vi.mock("../repositories/SerpRepository", () => ({
  SerpRepository: { getLatestForCluster: mocks.serpGetLatestForCluster },
}));
vi.mock("../repositories/AssetsRepository", () => ({
  AssetsRepository: { listByCluster: mocks.listByCluster },
}));
vi.mock("../repositories/OffersRepository", () => ({
  OffersRepository: { getById: mocks.offersGetById },
}));
vi.mock("../repositories/EvidencePacksRepository", () => ({
  EvidencePacksRepository: { insertVersion: mocks.insertVersion },
}));
vi.mock("../repositories/DecisionLogRepository", () => ({
  DecisionLogRepository: { append: mocks.appendLog },
}));
vi.mock(
  "@/server/features/project-context/services/ProjectContextService",
  () => ({
    getProjectContext: mocks.getProjectContext,
  }),
);
vi.mock(
  "@/server/features/content-factory/repositories/ResearchPagesRepository",
  () => ({
    ResearchPagesRepository: {
      getLatestForCluster: mocks.researchGetLatestForCluster,
    },
  }),
);
vi.mock("@/server/features/content-factory/services/KnowledgeService", () => ({
  KnowledgeService: { listForWriting: mocks.listForWriting },
}));
vi.mock("./llm", () => ({ runStructuredLlm: mocks.runStructuredLlm }));

import { EvidencePackService } from "./EvidencePackService";

const packContent = {
  targetUser: "buyer",
  userJob: "choose",
  primaryEntity: "strapping machine",
  verifiedFacts: [],
  specifications: "",
  buyerQuestions: [],
  serpFindings: "",
  competitorGaps: [],
  commercialInfo: "",
  imageIdeas: [],
  allowedClaims: [],
  prohibitedClaims: [],
  brandPosition: "",
  cta: "",
  openQuestions: [],
  sources: [],
};

beforeEach(() => {
  mocks.clusterGetById.mockResolvedValue({
    id: "cluster-1",
    projectId: "project-1",
    status: "decided",
    name: "strapping machine price",
    primaryEntity: "strapping machine",
    userJob: "choose",
    offerId: null,
  });
  mocks.getKeywords.mockResolvedValue([]);
  mocks.serpGetLatestForCluster.mockResolvedValue([]);
  mocks.listByCluster.mockResolvedValue([]);
  mocks.getProjectContext.mockResolvedValue({
    sections: [],
    customSections: [],
  });
  mocks.researchGetLatestForCluster.mockResolvedValue([
    {
      url: "https://competitor.com/guide",
      title: "Guide",
      bodyText: "real body text",
      fetchStatus: "ok",
    },
  ]);
  mocks.runStructuredLlm.mockResolvedValue({
    object: packContent,
    model: "test-model",
  });
  mocks.insertVersion.mockResolvedValue({ id: "pack-1", version: 1 });
  mocks.listForWriting.mockResolvedValue({ fresh: [], stale: [] });
});

describe("EvidencePackService.buildPack", () => {
  // The gate that makes "read the bodies before writing" structural rather
  // than a rule the agent is trusted to remember.
  it("refuses to build a pack when no ranking pages have been read", async () => {
    mocks.researchGetLatestForCluster.mockResolvedValue([]);

    await expect(
      EvidencePackService.buildPack({
        projectId: "project-1",
        clusterId: "cluster-1",
      }),
    ).rejects.toMatchObject({ code: "RANKING_PAGES_NOT_READ" });
    expect(mocks.runStructuredLlm).not.toHaveBeenCalled();
  });

  it("feeds read bodies to the prompt and unreadable URLs separately", async () => {
    mocks.researchGetLatestForCluster.mockResolvedValue([
      {
        url: "https://competitor.com/guide",
        title: "Guide",
        bodyText: "real body text",
        fetchStatus: "ok",
      },
      {
        url: "https://paywalled.com/x",
        title: null,
        bodyText: null,
        fetchStatus: "blocked",
      },
    ]);

    await EvidencePackService.buildPack({
      projectId: "project-1",
      clusterId: "cluster-1",
    });

    const { prompt } = mocks.runStructuredLlm.mock.calls[0][0];
    expect(prompt).toContain("real body text");
    expect(prompt).toContain("https://paywalled.com/x");
    // A blocked page must never be presented as evidence of what it covers.
    expect(prompt).not.toMatch(
      /Ranking-page bodies[\s\S]*https:\/\/paywalled\.com\/x[\s\S]*Pages that could NOT/,
    );
  });

  // The payoff of operator-entered product facts: the pack stops asking for
  // specs the project has already written down.
  it("puts approved knowledge in front of the model as established fact", async () => {
    mocks.listForWriting.mockResolvedValue({
      fresh: [{ statement: "MCM panels are 3mm nominal thickness" }],
      stale: [],
    });

    await EvidencePackService.buildPack({
      projectId: "project-1",
      clusterId: "cluster-1",
    });

    const { prompt } = mocks.runStructuredLlm.mock.calls[0][0];
    expect(prompt).toContain("OUR OWN VERIFIED KNOWLEDGE");
    expect(prompt).toContain("3mm nominal thickness");
  });

  // An adjacent category must reach the model as "we do not sell this", or
  // the pack describes a product the business does not have.
  it("frames an adjacent category as the alternative, not as our product", async () => {
    mocks.clusterGetById.mockResolvedValue({
      id: "cluster-1",
      projectId: "project-1",
      status: "decided",
      name: "flexible brick",
      primaryEntity: "brick veneer",
      userJob: "choose",
      offerId: null,
      entityCategory: "PU_STONE",
    });
    mocks.getProjectContext.mockResolvedValue({
      sections: [],
      customSections: [
        {
          slug: "entity-taxonomy",
          content:
            "TARGET: MCM — what we sell\nADJACENT: PU_STONE — faux brick",
        },
      ],
    });

    await EvidencePackService.buildPack({
      projectId: "project-1",
      clusterId: "cluster-1",
    });

    const { prompt } = mocks.runStructuredLlm.mock.calls[0][0];
    expect(prompt).toContain("ADJACENT CATEGORY");
    expect(prompt).toContain('"PU_STONE", which this business does NOT sell');
    expect(prompt).toContain("it sells MCM");
  });

  // "Which pages did this article read?" has to be answerable from the log.
  it("records the read and unreadable URLs in the decision log", async () => {
    await EvidencePackService.buildPack({
      projectId: "project-1",
      clusterId: "cluster-1",
    });

    const snapshot: unknown = JSON.parse(
      mocks.appendLog.mock.calls[0][0].inputSnapshot,
    );
    expect(snapshot).toMatchObject({
      readPageUrls: ["https://competitor.com/guide"],
      unreadableUrls: [],
    });
  });
});
