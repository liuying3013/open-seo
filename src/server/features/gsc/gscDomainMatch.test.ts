import { describe, expect, it } from "vitest";
import { pickPropertyForDomain } from "./gscDomainMatch";

const prop = (
  siteUrl: string,
  accountId = "acc1",
  permissionLevel = "siteOwner",
) => ({ accountId, accountEmail: null, siteUrl, permissionLevel });

describe("pickPropertyForDomain", () => {
  it("prefers the domain property, then https apex, then https www", () => {
    const candidates = [
      prop("https://www.example.com/"),
      prop("https://example.com/"),
      prop("sc-domain:example.com"),
    ];

    expect(pickPropertyForDomain("example.com", candidates)).toMatchObject({
      match: { siteUrl: "sc-domain:example.com" },
    });
    expect(
      pickPropertyForDomain("example.com", candidates.slice(0, 2)),
    ).toMatchObject({ match: { siteUrl: "https://example.com/" } });
    expect(
      pickPropertyForDomain("example.com", candidates.slice(0, 1)),
    ).toMatchObject({ match: { siteUrl: "https://www.example.com/" } });
  });

  it("does not match other hosts, http, or sub-path properties", () => {
    const candidates = [
      prop("sc-domain:example.org"),
      prop("https://blog.example.com/"),
      prop("https://example.com/blog/"),
      prop("http://example.com/"),
    ];

    expect(pickPropertyForDomain("example.com", candidates)).toEqual({
      failure: "no_matching_property",
    });
  });

  it("ignores unverified properties and says so when they are the only match", () => {
    expect(
      pickPropertyForDomain("example.com", [
        prop("sc-domain:example.com", "acc1", "siteUnverifiedUser"),
      ]),
    ).toEqual({ failure: "unverified_only" });
    expect(
      pickPropertyForDomain("example.com", [
        prop("sc-domain:example.com", "acc1", "siteUnverifiedUser"),
        prop("https://example.com/", "acc2"),
      ]),
    ).toMatchObject({ match: { accountId: "acc2" } });
  });

  it("picks the higher permission level when two accounts see the same property", () => {
    expect(
      pickPropertyForDomain("example.com", [
        prop("sc-domain:example.com", "acc1", "siteRestrictedUser"),
        prop("sc-domain:example.com", "acc2", "siteOwner"),
      ]),
    ).toMatchObject({ match: { accountId: "acc2" } });
  });
});
