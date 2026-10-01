import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getCluster: vi.fn(),
  keywords: vi.fn(),
  transition: vi.fn(),
  client: vi.fn(),
  budget: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/dataforseo/client", () => ({
  createDataforseoClient: mocks.client,
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: {},
}));
vi.mock(
  "@/server/features/project-context/repositories/ProjectContextRepository",
  () => ({ ProjectContextRepository: {} }),
);
vi.mock("../repositories/ClustersRepository", () => ({
  ClustersRepository: {
    getById: mocks.getCluster,
    getKeywords: mocks.keywords,
    transitionStatus: mocks.transition,
  },
}));
vi.mock("../repositories/SerpRepository", () => ({ SerpRepository: {} }));
vi.mock("./BudgetService", () => ({
  BudgetService: { consume: mocks.budget },
}));
import { SerpFetchService } from "./SerpFetchService";
import { serpRequestKey } from "@/shared/content-workbench";
const keyword = {
  keyword: "panel",
  locationCode: 2840,
  languageCode: "en",
  isRepresentative: true,
};
const input = {
  projectId: "p",
  clusterId: "c",
  customer: {
    organizationId: "org",
    userId: "u",
    userEmail: "test@example.com",
  },
  approvedRequestKey: serpRequestKey([keyword], 20),
};
beforeEach(() => {
  mocks.getCluster.mockResolvedValue({ status: "pre_scored" });
});
describe("workbench SERP approval", () => {
  it.each([
    [{ ...keyword, keyword: "new keyword" }],
    [{ ...keyword, locationCode: 2826 }],
    [keyword, { ...keyword, keyword: "second keyword" }],
  ])(
    "rejects changed request inputs before billing or claiming work",
    async (...keywords) => {
      mocks.keywords.mockResolvedValue(keywords);
      await expect(
        SerpFetchService.fetchClusterSerps(input),
      ).rejects.toMatchObject({ code: "SERP_NOT_READY" });
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.budget).not.toHaveBeenCalled();
      expect(mocks.transition).not.toHaveBeenCalled();
    },
  );
  it("does not authorize mobile requests with a desktop quote", async () => {
    mocks.keywords.mockResolvedValue([keyword]);
    await expect(
      SerpFetchService.fetchClusterSerps({ ...input, devices: ["mobile"] }),
    ).rejects.toMatchObject({ code: "SERP_NOT_READY" });
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
