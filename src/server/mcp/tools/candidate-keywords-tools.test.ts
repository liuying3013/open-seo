import { beforeEach, describe, expect, it, vi } from "vitest";
import { listCandidateKeywordsTool } from "./list-candidate-keywords";
import { saveCandidateKeywordsTool } from "./save-candidate-keywords";
import { makeToolContext } from "./tool-test-support";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

vi.mock("@/server/features/keywords/services/CandidateKeywordsService", () => ({
  CandidateKeywordsService: {
    list: mocks.list,
    save: mocks.save,
  },
}));

const toolContext = makeToolContext();

describe("candidate keyword MCP tools", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: "project_1",
      locationCode: 2840,
      languageCode: "en",
    });
  });

  it("saves candidates with source and market", async () => {
    mocks.save.mockResolvedValue({
      savedCount: 2,
      rows: [{ keyword: "flexible mcm panel" }, { keyword: "mcm vs pu stone" }],
    });

    const result = await saveCandidateKeywordsTool.handler(
      {
        projectId: "project_1",
        keywords: ["flexible mcm panel", "mcm vs pu stone"],
        source: "competitor",
      },
      toolContext,
    );

    expect(mocks.save).toHaveBeenCalledWith({
      projectId: "project_1",
      keywords: ["flexible mcm panel", "mcm vs pu stone"],
      locationCode: 2840,
      languageCode: "en",
      source: "competitor",
    });
    expect(result.structuredContent).toMatchObject({
      savedCount: 2,
      keywords: ["flexible mcm panel", "mcm vs pu stone"],
      source: "competitor",
    });
  });

  it("filters list_candidate_keywords by search", async () => {
    mocks.list.mockResolvedValue({
      rows: [
        { keyword: "flexible mcm panel", source: "competitor" },
        { keyword: "pu stone cladding", source: "manual" },
      ],
    });

    const result = await listCandidateKeywordsTool.handler(
      {
        projectId: "project_1",
        search: "mcm",
      },
      toolContext,
    );

    expect(mocks.list).toHaveBeenCalledWith({ projectId: "project_1" });
    expect(result.structuredContent).toMatchObject({
      totalCount: 2,
      rows: [{ keyword: "flexible mcm panel" }],
    });
  });
});
