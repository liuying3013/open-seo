import { describe, expect, it } from "vitest";
import { runContentChecks, type ContentDraft } from "./contentChecks";

function draft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    title: "A practical guide to choosing the right widget",
    metaDescription:
      "How to pick a widget: the sizes, materials and trade-offs that matter, with a short checklist you can use today.",
    slug: "guide",
    body: "## Start\n\nText.\n\n## Next\n\nMore text.",
    internalLinkTargets: [],
    imageBriefs: [],
    cta: "",
    structuredDataType: null,
    claimsUsed: [],
    ...overrides,
  };
}

const level = (report: ReturnType<typeof runContentChecks>, id: string) =>
  report.checks.find((check) => check.id === id)?.level;

describe("runContentChecks", () => {
  it("passes a clean draft and leaves internal links unchecked until site pages exist", () => {
    const report = runContentChecks(draft());
    expect(report.blocking).toBe(0);
    expect(level(report, "internal_links")).toBe("unchecked");
    expect(level(report, "title_length")).toBe("pass");
  });

  it("warns on structure and length problems without blocking", () => {
    const report = runContentChecks(
      draft({
        title: "Too short",
        body: "## A\n\n#### Skipped\n\n![](x.png)",
      }),
    );
    expect(level(report, "title_length")).toBe("warning");
    expect(level(report, "heading_order")).toBe("warning");
    expect(level(report, "image_alt")).toBe("warning");
    expect(report.blocking).toBe(0);
  });

  it("blocks prohibited claims, a second H1 and unsupported structured data", () => {
    const report = runContentChecks(
      draft({
        body: "# One\n\n# Two\n\nWe tested it ourselves.",
        structuredDataType: "FAQPage",
      }),
      { prohibitedClaims: ["we tested it ourselves"] },
    );
    expect(level(report, "h1")).toBe("blocking");
    expect(level(report, "prohibited_claims")).toBe("blocking");
    expect(level(report, "structured_data")).toBe("blocking");
  });
});
