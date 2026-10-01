import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapUrls, parseSitemapLocs } from "./site-route-map";

let repo: string;

function touch(relative: string) {
  const file = path.join(repo, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "");
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), "route-map-"));
  for (const file of [
    "src/routes/__root.tsx",
    "src/routes/index.tsx",
    "src/routes/about.tsx",
    "src/routes/pricing.lazy.tsx",
    "src/routes/blog/route.tsx",
    "src/routes/blog/index.tsx",
    "src/routes/blog/$slug.tsx",
    "src/routes/blog/featured.tsx",
    "src/routes/docs.guide.setup.tsx",
    "src/routes/(marketing)/features.tsx",
    "src/routes/_app/route.tsx",
    "src/routes/_app/dashboard.tsx",
    "src/routes/files/$.tsx",
    "src/routes/$lang/guides/$slug.tsx",
    "src/routes/-components/Hero.tsx",
    "src/content/blog/hello.mdx",
    "src/content/blog/hello.ar.mdx",
    "src/content/guides/intro.ar.mdx",
    "src/content/guides/intro.mdx",
  ]) {
    touch(file);
  }
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

const map = (...urls: string[]) =>
  Object.fromEntries(
    mapUrls(repo, urls).map(({ url, ...rest }) => [url, rest]),
  );

describe("mapUrls", () => {
  it("maps static routes: index, flat files, dot routes, groups, pathless layouts, lazy files", () => {
    const result = map(
      "https://example.com/",
      "https://example.com/about/",
      "https://example.com/pricing",
      "https://example.com/blog",
      "https://example.com/blog/featured",
      "https://example.com/docs/guide/setup",
      "https://example.com/features",
      "https://example.com/dashboard",
    );

    expect(Object.values(result).map((r) => [r.routeFile, r.status])).toEqual([
      ["src/routes/index.tsx", "matched"],
      ["src/routes/about.tsx", "matched"],
      ["src/routes/pricing.lazy.tsx", "matched"],
      ["src/routes/blog/index.tsx", "matched"],
      ["src/routes/blog/featured.tsx", "matched"],
      ["src/routes/docs.guide.setup.tsx", "matched"],
      ["src/routes/(marketing)/features.tsx", "matched"],
      ["src/routes/_app/dashboard.tsx", "matched"],
    ]);
  });

  it("prefers a static route over a $param sibling and finds the MDX for dynamic routes", () => {
    const result = map(
      "https://example.com/blog/featured",
      "https://example.com/blog/hello",
      "https://example.com/blog/missing",
    );

    expect(result["https://example.com/blog/featured"].status).toBe("matched");
    expect(result["https://example.com/blog/hello"]).toEqual({
      routeFile: "src/routes/blog/$slug.tsx",
      contentFile: "src/content/blog/hello.mdx",
      status: "dynamic",
    });
    expect(result["https://example.com/blog/missing"]).toEqual({
      routeFile: "src/routes/blog/$slug.tsx",
      contentFile: null,
      status: "dynamic",
    });
  });

  it("uses the language-specific MDX when the route has a lang param", () => {
    const result = map(
      "https://example.com/ar/guides/intro",
      "https://example.com/fr/guides/intro",
    );

    expect(result["https://example.com/ar/guides/intro"]).toEqual({
      routeFile: "src/routes/$lang/guides/$slug.tsx",
      contentFile: "src/content/guides/intro.ar.mdx",
      status: "dynamic",
    });
    // No French file: falls back to the default-language one.
    expect(result["https://example.com/fr/guides/intro"].contentFile).toBe(
      "src/content/guides/intro.mdx",
    );
  });

  it("maps splat routes and reports URLs with no route as unmatched", () => {
    const result = map(
      "https://example.com/files/a/b/c.pdf",
      "https://example.com/nope",
      "https://example.com/components/hero",
    );

    expect(result["https://example.com/files/a/b/c.pdf"]).toEqual({
      routeFile: "src/routes/files/$.tsx",
      contentFile: null,
      status: "dynamic",
    });
    expect(result["https://example.com/nope"]).toEqual({
      routeFile: null,
      contentFile: null,
      status: "unmatched",
    });
    // `-` prefixed files are not routes.
    expect(result["https://example.com/components/hero"].status).toBe(
      "unmatched",
    );
  });
});

describe("parseSitemapLocs", () => {
  it("reads <loc> entries and unescapes XML entities", () => {
    expect(
      parseSitemapLocs(
        `<urlset><url><loc>https://a.test/x?a=1&amp;b=2</loc></url><url><loc> https://a.test/y </loc></url></urlset>`,
      ),
    ).toEqual(["https://a.test/x?a=1&b=2", "https://a.test/y"]);
  });
});
