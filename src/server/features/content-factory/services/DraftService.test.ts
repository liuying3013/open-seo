import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getAsset: vi.fn(),
  saveDraft: vi.fn(),
  getPack: vi.fn(),
  context: vi.fn(),
  knowledge: vi.fn(),
  llm: vi.fn<(input: { prompt: string }) => Promise<unknown>>(),
  log: vi.fn(),
}));
vi.mock("@/server/features/content-ops/repositories/AssetsRepository", () => ({
  AssetsRepository: { getById: mocks.getAsset, saveDraft: mocks.saveDraft },
}));
vi.mock(
  "@/server/features/content-ops/repositories/EvidencePacksRepository",
  () => ({ EvidencePacksRepository: { getLatestForCluster: mocks.getPack } }),
);
vi.mock(
  "@/server/features/content-ops/repositories/DecisionLogRepository",
  () => ({ DecisionLogRepository: { append: mocks.log } }),
);
vi.mock("@/server/features/content-ops/services/llm", () => ({
  runStructuredLlm: mocks.llm,
}));
vi.mock("./ContextPackService", () => ({
  ContextPackService: { buildForCluster: mocks.context },
}));
vi.mock("./KnowledgeService", () => ({
  KnowledgeService: { listForWriting: mocks.knowledge },
}));
import { DraftService } from "./DraftService";
const draft = {
  title: "Panel guide",
  slug: "panel-guide",
  body: "Supported claim.",
  metaDescription: "Guide",
  internalLinkTargets: [],
  imageBriefs: [],
  cta: "Ask us",
  structuredDataType: null,
  claimsUsed: ["Supported claim"],
  addedValue: "Selection guidance",
};
const raw = JSON.stringify(draft);
const asset = {
  id: "a",
  projectId: "p",
  clusterId: "c",
  status: "drafted",
  platform: "money_site",
  brief: "Write a guide",
  draft: raw,
  updatedAt: "2026-09-13T00:00:00.000Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAsset.mockResolvedValue(asset);
  mocks.saveDraft.mockResolvedValue(true);
  mocks.getPack.mockResolvedValue({
    id: "pack",
    status: "approved",
    version: 1,
    content: "{}",
  });
  mocks.context.mockResolvedValue({
    rules: {},
    openQuestions: [],
    coveringPages: [],
  });
  mocks.knowledge.mockResolvedValue({ fresh: [] });
});
describe("web content editing and QA", () => {
  it("clears passing QA and uses a conditional write for an edited draft", async () => {
    mocks.getAsset.mockResolvedValue({ ...asset, status: "ready_to_publish" });
    await DraftService.saveEdited({
      projectId: "p",
      assetId: "a",
      expectedDraft: raw,
      draft: { ...draft, body: "Edited claim" },
    });
    expect(mocks.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "qa_review",
        qaReport: null,
        expected: {
          draft: raw,
          status: "ready_to_publish",
          updatedAt: asset.updatedAt,
        },
      }),
    );
    expect(mocks.llm).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: "user" }),
    );
  });
  it("rejects another project's asset before writing", async () => {
    mocks.getAsset.mockResolvedValue(null);
    await expect(
      DraftService.saveEdited({
        projectId: "other",
        assetId: "a",
        expectedDraft: raw,
        draft,
      }),
    ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    expect(mocks.getAsset).toHaveBeenCalledWith("other", "a");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });
  it("refuses stale browser edits", async () => {
    await expect(
      DraftService.saveEdited({
        projectId: "p",
        assetId: "a",
        expectedDraft: "older version",
        draft,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });
  it("refuses to edit published content", async () => {
    mocks.getAsset.mockResolvedValue({ ...asset, status: "published" });
    await expect(
      DraftService.saveEdited({
        projectId: "p",
        assetId: "a",
        expectedDraft: raw,
        draft,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });
  it("does not mark QA passed if an edit won the save race", async () => {
    mocks.llm.mockResolvedValue({ object: { findings: [] }, model: "test" });
    mocks.saveDraft.mockResolvedValue(false);
    await expect(
      DraftService.runQa({ projectId: "p", assetId: "a" }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("requires an approved pack before generating or reviewing", async () => {
    mocks.getPack.mockResolvedValue({ status: "draft" });
    await expect(
      DraftService.generate({ projectId: "p", assetId: "a" }),
    ).rejects.toMatchObject({ code: "EVIDENCE_PACK_NOT_APPROVED" });
    await expect(
      DraftService.runQa({ projectId: "p", assetId: "a" }),
    ).rejects.toMatchObject({ code: "EVIDENCE_PACK_NOT_APPROVED" });
    expect(mocks.llm).not.toHaveBeenCalled();
  });
  it("gives a rewrite the actual edited draft and enforces the two-round limit", async () => {
    const findings = [
      {
        dimension: "expression_quality",
        severity: "fix",
        detail: "Remove repetition",
      },
    ];
    mocks.llm
      .mockResolvedValueOnce({ object: { findings }, model: "test" })
      .mockResolvedValueOnce({
        object: { ...draft, body: "Revision one" },
        model: "test",
      })
      .mockResolvedValueOnce({ object: { findings }, model: "test" })
      .mockResolvedValueOnce({
        object: { ...draft, body: "Revision two" },
        model: "test",
      })
      .mockResolvedValueOnce({ object: { findings }, model: "test" });
    const report = await DraftService.runQa({ projectId: "p", assetId: "a" });
    expect(report.roundsUsed).toBe(2);
    expect(mocks.llm).toHaveBeenCalledTimes(5);
    expect(mocks.llm.mock.calls[1][0].prompt).toContain(raw);
    expect(mocks.llm.mock.calls[3][0].prompt).toContain("Revision one");
    expect(mocks.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ status: "qa_review" }),
    );
  });
});
