import { beforeEach, describe, expect, it, vi } from "vitest";
import { THIRD_PARTY_PLATFORMS } from "../rules/scoringRules";

const mocks = vi.hoisted(() => ({
  clusterGetById: vi.fn(),
  getProjectContext: vi.fn(),
  insert: vi.fn(),
  supersedeOpenProposals: vi.fn(),
  update: vi.fn(),
  appendLog: vi.fn(),
}));

vi.mock("../repositories/ClustersRepository", () => ({
  ClustersRepository: { getById: mocks.clusterGetById },
}));
vi.mock("../repositories/DecisionsRepository", () => ({
  DecisionsRepository: {
    insert: mocks.insert,
    supersedeOpenProposals: mocks.supersedeOpenProposals,
    update: mocks.update,
  },
}));
vi.mock("../repositories/DecisionLogRepository", () => ({
  DecisionLogRepository: { append: mocks.appendLog },
}));
vi.mock(
  "@/server/features/project-context/services/ProjectContextService",
  () => ({ getProjectContext: mocks.getProjectContext }),
);

import { DecideService } from "./DecideService";

// Descriptive lines on purpose: the id is the token after the prefix.
const TAXONOMY = [
  "TARGET: MCM — engineered clay panels, what we sell",
  "ADJACENT: PU_STONE — faux brick; our buyers, not our product",
  "NATURAL_STONE — quarried",
].join("\n");

// A product-page SERP with real YouTube presence, so the money-site rule
// would pick "product" and YouTube would normally earn better than SKIP.
function scoredCluster(entityCategory: string) {
  return {
    id: "cluster-1",
    projectId: "project-1",
    status: "scored",
    entityCategory,
    userJob: "choose",
    businessValueScore: 40,
    intentVector: JSON.stringify({ commercial: 0.6, transactional: 0.2 }),
    serpFormatScores: JSON.stringify({ product: 0.5, guide: 0.2 }),
    platformAcceptance: JSON.stringify(
      Object.fromEntries(
        THIRD_PARTY_PLATFORMS.map((p) => [p, p === "youtube" ? 0.4 : 0]),
      ),
    ),
  };
}

const decide = () =>
  DecideService.decideDeployment({
    projectId: "project-1",
    clusterId: "cluster-1",
  });

beforeEach(() => {
  mocks.getProjectContext.mockResolvedValue({
    customSections: [{ slug: "entity-taxonomy", content: TAXONOMY }],
  });
  mocks.insert.mockResolvedValue("decision-1");
});

describe("DecideService.decideDeployment", () => {
  it("keeps a target category on the SERP-driven page type", async () => {
    mocks.clusterGetById.mockResolvedValue(scoredCluster("MCM"));

    const result = await decide();

    expect(result.entityRelation).toBe("target");
    expect(result.pageType).toBe("product");
  });

  // The operator's rule: buyers of an adjacent category are our buyers, so
  // the cluster deploys — but as the alternative, and never on a product page
  // for something we do not stock.
  it("deploys an adjacent category as a comparison page instead of skipping it", async () => {
    mocks.clusterGetById.mockResolvedValue(scoredCluster("PU_STONE"));

    const result = await decide();

    expect(result.entityRelation).toBe("adjacent");
    expect(result.pageType).toBe("comparison");
    expect(result.pageTypeReason).toContain("does not sell");
    const youtube = result.platformPlan.find((p) => p.platform === "youtube");
    expect(youtube?.verdict).not.toBe("SKIP");
  });

  it("forces an off-target category to no page and SKIP everywhere", async () => {
    mocks.clusterGetById.mockResolvedValue(scoredCluster("NATURAL_STONE"));

    const result = await decide();

    expect(result.entityRelation).toBe("off_target");
    expect(result.pageType).toBe("none");
    expect(result.platformPlan.every((p) => p.verdict === "SKIP")).toBe(true);
  });
});
