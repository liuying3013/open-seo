import { describe, expect, it } from "vitest";
import { textMatchScore } from "./text-match";

const draft = {
  title: "How to choose a standing desk",
  body: [
    "## Height range matters",
    "",
    "A good desk should reach **your elbow height** when you stand.",
    "",
    "![desk photo](/img/desk.png)",
    "",
    "- Check the [weight limit](/guides/weight) before buying",
  ].join("\n"),
};

const livePage = `
  How to choose a standing desk
  Height range matters
  A good desk should reach your elbow height when you stand.
  Check the weight limit before buying
  Footer links and cookie banner text
`;

describe("textMatchScore", () => {
  it("scores 100 when the live page carries all approved text, markdown stripped", () => {
    expect(textMatchScore(draft, livePage)).toBe(100);
  });

  it("drops with missing sentences and is 0 for unrelated text", () => {
    const partial = livePage.replace(
      "A good desk should reach your elbow height when you stand.",
      "",
    );
    const score = textMatchScore(draft, partial);
    expect(score).toBeGreaterThan(30);
    expect(score).toBeLessThan(85);
    expect(textMatchScore(draft, "completely different words here")).toBe(0);
  });

  it("matches CJK text by character runs", () => {
    const cjk = { title: "如何选择升降桌", body: "升降桌的高度范围很重要。" };
    expect(
      textMatchScore(cjk, "首页 如何选择升降桌 升降桌的高度范围很重要"),
    ).toBe(100);
  });
});
