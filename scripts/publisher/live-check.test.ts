import { describe, expect, it } from "vitest";
import { inspectPage } from "./live-check";

const draft = {
  title: "Standing desks",
  body: "## Height\n\nChoose the right height for your desk.",
};
const headers = (values: Record<string, string> = {}) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("inspectPage", () => {
  const html = `<html><head><link rel="canonical" href="https://example.com/p">
    <meta name="robots" content="index, follow"></head>
    <body><nav>menu</nav><h1>Standing desks</h1><h2>Height</h2><p>Choose the right height for your desk.</p>
    <script>var ignored = 1;</script></body></html>`;

  it("reads canonical and scores adjacent blocks as separate text", () => {
    expect(inspectPage(html, headers(), draft)).toEqual({
      noindex: false,
      canonical: "https://example.com/p",
      textMatch: 100,
    });
  });

  it("detects noindex from the header and from meta robots", () => {
    expect(
      inspectPage(html, headers({ "x-robots-tag": "noindex" }), draft).noindex,
    ).toBe(true);
    const meta = html.replace("index, follow", "noindex,nofollow");
    expect(inspectPage(meta, headers(), draft).noindex).toBe(true);
  });
});
