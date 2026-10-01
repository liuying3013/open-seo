import { describe, expect, it } from "vitest";
import { classifyEntityRelation, parseEntityTaxonomy } from "./entityRules";

// Operators write descriptive lines ("TARGET: MCM — engineered clay panels");
// only the bare id may be matched against what disambiguation returns.
const TAXONOMY = [
  "Categories the SERP may resolve to:",
  "TARGET: MCM — engineered modified-clay panels, what we sell",
  "ADJACENT: PU_STONE — polyurethane faux brick; our buyers, not our product",
  "adjacent: natural_stone — quarried slabs, brick veneer",
  "OTHER — wallpaper, paint, anything unrelated",
].join("\n");

describe("parseEntityTaxonomy", () => {
  it("takes the id token after a case-insensitive prefix and ignores bare lines", () => {
    expect(parseEntityTaxonomy(TAXONOMY)).toEqual({
      target: ["MCM"],
      adjacent: ["PU_STONE", "natural_stone"],
    });
  });
});

describe("classifyEntityRelation", () => {
  it.each([
    ["MCM", "target"],
    ["PU_STONE", "adjacent"],
    ["OTHER", "off_target"],
    ["PORCELAIN", "off_target"],
  ])("classifies %s as %s", (entityCategory, relation) => {
    expect(classifyEntityRelation({ taxonomy: TAXONOMY, entityCategory })).toBe(
      relation,
    );
  });

  it("classifies nothing until the project declares a TARGET", () => {
    expect(
      classifyEntityRelation({
        taxonomy: "ADJACENT: PU_STONE\nNATURAL_STONE",
        entityCategory: "NATURAL_STONE",
      }),
    ).toBe("unclassified");
    expect(
      classifyEntityRelation({ taxonomy: TAXONOMY, entityCategory: null }),
    ).toBe("unclassified");
  });
});
