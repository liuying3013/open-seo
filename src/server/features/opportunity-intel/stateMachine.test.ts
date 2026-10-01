import { describe, expect, it } from "vitest";
import { OpportunityIntelError } from "./opportunityIntelErrors";
import { assertOpportunityTransition } from "./stateMachine";

describe("assertOpportunityTransition", () => {
  it("allows the V0.1 forward path", () => {
    expect(() => {
      assertOpportunityTransition("discovered", "keyword_scanned");
      assertOpportunityTransition("keyword_scanned", "serp_validated");
      assertOpportunityTransition("serp_validated", "shortlisted");
      assertOpportunityTransition("shortlisted", "graduated");
    }).not.toThrow();
  });

  it("rejects stage skipping", () => {
    expect(() =>
      assertOpportunityTransition("discovered", "shortlisted"),
    ).toThrow(OpportunityIntelError);
  });

  it("graduated is terminal", () => {
    expect(() => assertOpportunityTransition("graduated", "rejected")).toThrow(
      OpportunityIntelError,
    );
  });

  it("rejected can only be resurrected to watchlist", () => {
    expect(() =>
      assertOpportunityTransition("rejected", "watchlist"),
    ).not.toThrow();
    expect(() => assertOpportunityTransition("rejected", "discovered")).toThrow(
      OpportunityIntelError,
    );
  });

  it("watchlist resumes anywhere mid-pipeline", () => {
    expect(() =>
      assertOpportunityTransition("watchlist", "keyword_scanned"),
    ).not.toThrow();
    expect(() =>
      assertOpportunityTransition("watchlist", "shortlisted"),
    ).not.toThrow();
    expect(() => assertOpportunityTransition("watchlist", "graduated")).toThrow(
      OpportunityIntelError,
    );
  });
});
