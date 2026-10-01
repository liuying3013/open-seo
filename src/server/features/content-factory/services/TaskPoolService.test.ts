import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listByProject: vi.fn(),
  getKeywords: vi.fn(),
  snapshots: vi.fn(),
  pages: vi.fn(),
  budget: vi.fn(),
  coverage: vi.fn(),
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: { listProjects: mocks.listProjects },
}));
vi.mock(
  "@/server/features/content-ops/repositories/ClustersRepository",
  () => ({
    ClustersRepository: {
      listByProject: mocks.listByProject,
      getKeywords: mocks.getKeywords,
    },
  }),
);
vi.mock("@/server/features/content-ops/repositories/SerpRepository", () => ({
  SerpRepository: { getLatestForCluster: mocks.snapshots },
}));
vi.mock("../repositories/ResearchPagesRepository", () => ({
  ResearchPagesRepository: { getLatestForCluster: mocks.pages },
}));
vi.mock("@/server/features/content-ops/services/BudgetService", () => ({
  BudgetService: { getToday: mocks.budget },
}));
vi.mock("./PageCoverageService", () => ({
  PageCoverageService: { classifyCluster: mocks.coverage },
}));
import { TaskPoolService } from "./TaskPoolService";

beforeEach(() => {
  mocks.listProjects.mockResolvedValue([{ id: "p", name: "Project" }]);
  mocks.listByProject.mockResolvedValue([
    { id: "one", name: "One", status: "pre_scored", businessValueScore: 90 },
    { id: "two", name: "Two", status: "pre_scored", businessValueScore: 70 },
  ]);
  mocks.getKeywords.mockResolvedValue([
    { isRepresentative: true },
    { isRepresentative: false },
  ]);
  mocks.snapshots.mockResolvedValue([]);
  mocks.pages.mockResolvedValue([]);
  mocks.budget.mockResolvedValue({
    usage: { serpFetches: { used: 8, limit: 10 } },
  });
  mocks.coverage.mockResolvedValue({ verdict: "new" });
});
describe("TaskPoolService", () => {
  it("fits two one-representative topics into two remaining requests", async () => {
    const pool = await TaskPoolService.build({ organizationId: "org" });
    expect(pool.runnable).toBe(2);
    expect(pool.tasks.map((task) => task.pendingSerpFetches)).toEqual([1, 1]);
  });
  it("blocks the second topic when only one request remains", async () => {
    mocks.budget.mockResolvedValue({
      usage: { serpFetches: { used: 9, limit: 10 } },
    });
    const pool = await TaskPoolService.build({ organizationId: "org" });
    expect(pool.runnable).toBe(1);
    expect(pool.tasks[1].blockedBy).toContain("needs 1");
  });
  it("does not reserve more requests for topics with stored SERPs", async () => {
    mocks.snapshots.mockResolvedValue([{ id: "snapshot" }]);
    mocks.budget.mockResolvedValue({
      usage: { serpFetches: { used: 10, limit: 10 } },
    });
    const pool = await TaskPoolService.build({ organizationId: "org" });
    expect(pool.runnable).toBe(2);
    expect(pool.tasks.every((task) => task.pendingSerpFetches === 0)).toBe(
      true,
    );
    expect(mocks.getKeywords).not.toHaveBeenCalled();
  });
});
