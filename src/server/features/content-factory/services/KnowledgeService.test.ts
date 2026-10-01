import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  listSources: vi.fn(),
  setStatus: vi.fn(),
  listAffectedAssets: vi.fn(),
  listUsableForWriting: vi.fn(),
  appendLog: vi.fn<(entry: { inputSnapshot: string }) => Promise<string>>(),
}));

vi.mock("../repositories/KnowledgeRepository", () => ({
  KnowledgeRepository: {
    getById: mocks.getById,
    listSources: mocks.listSources,
    setStatus: mocks.setStatus,
    listAffectedAssets: mocks.listAffectedAssets,
    listUsableForWriting: mocks.listUsableForWriting,
  },
}));
vi.mock(
  "@/server/features/content-ops/repositories/DecisionLogRepository",
  () => ({ DecisionLogRepository: { append: mocks.appendLog } }),
);

import { KnowledgeService } from "./KnowledgeService";

const ownSource = { isIndependent: true, isOwnContent: true };
const outsideSource = { isIndependent: true, isOwnContent: false };

beforeEach(() => {
  mocks.getById.mockResolvedValue({
    id: "k1",
    statement: "MCM panels bend to a 50mm radius",
    claimType: "fact",
  });
  mocks.listSources.mockResolvedValue([outsideSource]);
  mocks.setStatus.mockResolvedValue(true);
  mocks.listAffectedAssets.mockResolvedValue([]);
});

describe("KnowledgeService.approve", () => {
  // The self-citation ban has to live here rather than in the prompt: a model
  // that forgets it produces a confident claim with nothing behind it.
  it("refuses a fact whose only sources are our own content", async () => {
    mocks.listSources.mockResolvedValue([ownSource, ownSource]);

    await expect(
      KnowledgeService.approve({
        projectId: "p1",
        knowledgeId: "k1",
        approvedBy: "user",
      }),
    ).rejects.toMatchObject({ code: "SELF_CITATION_BLOCKED" });
    expect(mocks.setStatus).not.toHaveBeenCalled();
  });

  it("approves once one source is independent of us", async () => {
    mocks.listSources.mockResolvedValue([ownSource, outsideSource]);

    const result = await KnowledgeService.approve({
      projectId: "p1",
      knowledgeId: "k1",
      approvedBy: "user",
    });

    expect(result.status).toBe("approved");
    expect(mocks.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "approved" }),
    );
  });
});

describe("KnowledgeService.retract", () => {
  // Knowledge and published pages must not drift apart quietly.
  it("reports the assets that used a retracted claim and logs the impact", async () => {
    mocks.listAffectedAssets.mockResolvedValue([
      { assetId: "a1", platform: "money_site", status: "published" },
    ]);

    const result = await KnowledgeService.retract({
      projectId: "p1",
      knowledgeId: "k1",
      reason: "Supplier corrected the spec.",
      by: "user",
    });

    expect(result.status).toBe("retracted");
    expect(result.affected).toHaveLength(1);
    const snapshot: unknown = JSON.parse(
      mocks.appendLog.mock.calls[0][0].inputSnapshot,
    );
    expect(snapshot).toMatchObject({ affectedAssetIds: ["a1"] });
  });

  // The asset state machine has no published -> refresh edge; a knowledge
  // correction must not invent one behind the operator's back.
  it("does not change the affected asset's own status", async () => {
    mocks.listAffectedAssets.mockResolvedValue([
      { assetId: "a1", platform: "money_site", status: "published" },
    ]);

    await KnowledgeService.retract({
      projectId: "p1",
      knowledgeId: "k1",
      reason: "x",
      by: "user",
    });

    for (const call of mocks.setStatus.mock.calls) {
      expect(call[0]).toMatchObject({ id: "k1" });
    }
  });
});

describe("KnowledgeService.listForWriting", () => {
  it("splits fresh from stale and never returns internal-scope claims", async () => {
    const past = "2000-01-01T00:00:00.000Z";
    const future = "2999-01-01T00:00:00.000Z";
    mocks.listUsableForWriting.mockResolvedValue([
      {
        id: "fresh",
        status: "approved",
        scope: "public",
        recheckAfter: future,
      },
      { id: "stale", status: "approved", scope: "public", recheckAfter: past },
      // The repository query already filters these out; the service re-checks
      // so a future caller cannot widen the query and quietly leak them.
      {
        id: "leak",
        status: "approved",
        scope: "internal",
        recheckAfter: future,
      },
    ]);

    const result = await KnowledgeService.listForWriting({ projectId: "p1" });

    expect(result.fresh.map((r) => r.id)).toEqual(["fresh"]);
    expect(result.stale.map((r) => r.id)).toEqual(["stale"]);
  });
});
