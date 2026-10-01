import { describe, expect, it } from "vitest";
import { normalizeKeyword } from "./normalizeKeyword";

describe("normalizeKeyword", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeKeyword("  ABB   ACS580  Manual ")).toBe(
      "abb acs580 manual",
    );
  });

  it("unicode-normalizes fullwidth forms (pasted CJK-context keywords)", () => {
    expect(normalizeKeyword("ＶＦＤ ｄｒｉｖｅ")).toBe("vfd drive");
  });

  it("does not stem — plural variants stay distinct", () => {
    expect(normalizeKeyword("vfds")).not.toBe(normalizeKeyword("vfd"));
  });
});
