import { describe, expect, it } from "vitest";
import { heuristicContentType, platformForDomain } from "./platformMap";

describe("platformForDomain", () => {
  it("maps known platforms including subdomains and www", () => {
    expect(platformForDomain("www.reddit.com")).toBe("reddit");
    expect(platformForDomain("old.reddit.com")).toBe("reddit");
    expect(platformForDomain("m.youtube.com")).toBe("youtube");
    expect(platformForDomain("medium.com")).toBe("medium");
  });

  it("returns null for regular websites (money sites, manufacturers)", () => {
    expect(platformForDomain("vfddistributor.com")).toBeNull();
    expect(platformForDomain("new.abb.com")).toBeNull();
  });
});

describe("heuristicContentType", () => {
  it("detects comparisons from vs-titles and urls", () => {
    expect(
      heuristicContentType({
        resultType: "organic",
        url: "https://example.com/acs580-vs-g120",
        title: "ABB ACS580 vs Siemens G120",
        platform: null,
      }),
    ).toBe("comparison");
  });

  it("classifies platform results by platform, not URL shape", () => {
    expect(
      heuristicContentType({
        resultType: "organic",
        url: "https://www.reddit.com/r/PLC/comments/abc",
        title: "Which VFD should I buy?",
        platform: "reddit",
      }),
    ).toBe("forum_thread");
  });

  it("returns null when unsure, leaving the call to the LLM pass", () => {
    expect(
      heuristicContentType({
        resultType: "organic",
        url: "https://example.com/acs580",
        title: "ACS580",
        platform: null,
      }),
    ).toBeNull();
  });
});
