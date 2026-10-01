import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleInternalJobRequest } from "./handleInternalJobRequest";

const mocks = vi.hoisted(() => ({
  getOptionalEnvValue: vi.fn(),
  runScheduledRankChecks: vi.fn(),
  reconcileStaleAudits: vi.fn(),
  start: vi.fn(),
  finish: vi.fn(),
}));

vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: mocks.getOptionalEnvValue,
}));
vi.mock("@/db", () => ({ withPgClient: (fn: () => unknown) => fn() }));
vi.mock("@/server/referrals/dub", () => ({
  sweepDubReferredOrganizations: vi.fn(),
}));
vi.mock("@/server/features/rank-tracking/services/scheduledRankChecks", () => ({
  runScheduledRankChecks: mocks.runScheduledRankChecks,
}));
vi.mock("@/server/features/audit/services/auditReconciler", () => ({
  reconcileStaleAudits: mocks.reconcileStaleAudits,
}));
vi.mock("@/server/features/job-runs/repositories/JobRunRepository", () => ({
  JobRunRepository: mocks,
}));

const TOKEN = "secret-token";
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- jobs only forward env to collaborators, which are mocked here
const env = {} as unknown as Env;

function post(job: string, authorization?: string) {
  return handleInternalJobRequest(
    new Request(`https://example.test/api/internal/jobs/${job}`, {
      method: "POST",
      headers: authorization ? { authorization } : {},
    }),
    job,
    env,
  );
}

describe("internal job trigger", () => {
  beforeEach(() => {
    mocks.getOptionalEnvValue.mockResolvedValue(TOKEN);
  });

  it("is closed (404) when INTERNAL_JOBS_TOKEN is not configured", async () => {
    mocks.getOptionalEnvValue.mockResolvedValue(undefined);

    const response = await post("frequent", `Bearer ${TOKEN}`);

    expect(response.status).toBe(404);
    expect(mocks.runScheduledRankChecks).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong token", async () => {
    expect((await post("frequent")).status).toBe(401);
    expect((await post("frequent", "Bearer nope")).status).toBe(401);
    expect(mocks.runScheduledRankChecks).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown job", async () => {
    expect((await post("nightly", `Bearer ${TOKEN}`)).status).toBe(404);
  });

  it("runs the job and records the run", async () => {
    const response = await post("frequent", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(mocks.reconcileStaleAudits).toHaveBeenCalledOnce();
    expect(mocks.runScheduledRankChecks).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ job: "frequent", trigger: "http" }),
    );
    expect(mocks.finish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "succeeded" }),
    );
  });

  it("records a failed run and answers 500 when the job throws", async () => {
    mocks.runScheduledRankChecks.mockRejectedValue(new Error("boom"));

    const response = await post("frequent", `Bearer ${TOKEN}`);

    expect(response.status).toBe(500);
    expect(mocks.finish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed", detail: "boom" }),
    );
  });
});
