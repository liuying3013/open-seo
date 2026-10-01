import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpportunityIntelError } from "../opportunityIntelErrors";
import { OpportunityBudgetsRepository } from "../repositories/OpportunityBudgetsRepository";
import { checkDailyBudget } from "./costs";

vi.mock("../repositories/OpportunityBudgetsRepository", () => ({
  OpportunityBudgetsRepository: {
    tryConsume: vi.fn(),
    getDay: vi.fn(),
  },
}));
vi.mock("../repositories/OpportunityCostEventsRepository", () => ({
  OpportunityCostEventsRepository: { insert: vi.fn() },
}));

const tryConsumeMock = vi.mocked(OpportunityBudgetsRepository.tryConsume);
const getDayMock = vi.mocked(OpportunityBudgetsRepository.getDay);

beforeEach(() => {
  tryConsumeMock.mockResolvedValue(true);
  getDayMock.mockResolvedValue({
    organizationId: "org-1",
    date: "2026-09-01",
    llmCalls: 0,
    keywordLookups: 0,
    serpFetches: 0,
  });
});

describe("checkDailyBudget", () => {
  it("passes while the day's aggregate is under the limit", async () => {
    await expect(
      checkDailyBudget("org-1", "serp_advanced"),
    ).resolves.toBeUndefined();
    expect(tryConsumeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        kind: "serpFetches",
        amount: 1,
      }),
    );
  });

  it("fails closed when the atomic daily reservation is rejected", async () => {
    tryConsumeMock.mockResolvedValue(false);
    getDayMock.mockResolvedValue({
      organizationId: "org-1",
      date: "2026-09-01",
      llmCalls: 300,
      keywordLookups: 0,
      serpFetches: 0,
    });
    await expect(checkDailyBudget("org-1", "llm_expand")).rejects.toMatchObject(
      {
        code: "BUDGET_EXCEEDED",
      },
    );
    await expect(
      checkDailyBudget("org-1", "llm_expand"),
    ).rejects.toBeInstanceOf(OpportunityIntelError);
  });
});
