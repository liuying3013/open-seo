/**
 * Maps live URLs back to source files for sites built on TanStack Router's
 * file-based routing (`src/routes`), plus the MDX content file behind dynamic
 * `$slug` routes. Pure matching lives here; map-site-routes.ts is the CLI.
 *
 * Supported file conventions: `index.tsx`, `route.tsx` (directory layout),
 * `$param`, `$.tsx` (splat), `{-$param}` (optional), `_prefix` pathless
 * layouts, `(group)` directories, flat dot routes (`a.b.tsx`), trailing `_`
 * (opt out of layout nesting), `[x]` escapes, `.lazy` suffix, and `-` prefixed
 * files that the router ignores.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export type RouteSegment = {
  kind: "static" | "param" | "optional" | "splat";
  value: string;
};

export type RouteEntry = {
  /** Path relative to the repository root, forward slashes. */
  file: string;
  segments: RouteSegment[];
  /** Another route file is nested under this one (so it renders an Outlet). */
  isParent: boolean;
};

export type MappedUrl = {
  url: string;
  routeFile: string | null;
  contentFile: string | null;
  status: "matched" | "dynamic" | "unmatched";
};

const ROUTE_EXTENSION = /\.(tsx|ts|jsx|js)$/;
const KIND_RANK = { static: 0, param: 1, optional: 2, splat: 3 } as const;
const LANGUAGE_PARAMS = new Set(["lang", "locale", "language"]);

// Splits on dots that are not inside `[...]` escapes.
function splitDots(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "[") depth += 1;
    if (char === "]") depth = Math.max(0, depth - 1);
    if (char === "." && depth === 0) {
      tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  tokens.push(current);
  return tokens.filter(Boolean);
}

function toSegment(token: string): RouteSegment | null {
  // Groups and pathless layouts do not appear in the URL.
  if (/^\(.*\)$/.test(token) || token.startsWith("_")) return null;
  const name = token.replace(/_$/, "");
  if (name === "$") return { kind: "splat", value: "*" };
  const optional = /^(?:[^{]*)\{-\$([^}]+)\}/.exec(name);
  if (optional) return { kind: "optional", value: optional[1] };
  const param = /^\$(.+)$/.exec(name) ?? /\{\$([^}]+)\}/.exec(name);
  if (param) return { kind: "param", value: param[1] };
  return { kind: "static", value: name.replaceAll(/\[(.*?)\]/g, "$1") };
}

type ParsedRoute = {
  file: string;
  id: string;
  segments: RouteSegment[];
  lazy: boolean;
};

function parseRouteFile(
  relative: string,
  repoRelativeRoutesDir: string,
): ParsedRoute | null {
  const withoutExtension = relative.replace(ROUTE_EXTENSION, "");
  if (withoutExtension === relative) return null;
  const lazy = withoutExtension.endsWith(".lazy");
  const stem = lazy
    ? withoutExtension.slice(0, -".lazy".length)
    : withoutExtension;
  const parts = stem.split("/");
  const last = parts.at(-1) ?? "";
  if (
    parts.some((part) => part.startsWith("-")) ||
    last.startsWith("__root") ||
    /\.(test|spec|d)$/.test(last) ||
    last === "routeTree.gen"
  ) {
    return null;
  }
  const tokens = parts.flatMap(splitDots);
  // `route` is the layout file of its directory, so it adds no segment.
  if (tokens.at(-1) === "route") tokens.pop();
  const segments = tokens
    .filter((token) => token !== "index")
    .flatMap((token) => {
      const segment = toSegment(token);
      return segment ? [segment] : [];
    });
  return {
    file: path.posix.join(repoRelativeRoutesDir, relative),
    id: tokens.join("/"),
    segments,
    lazy,
  };
}

/** Builds the route table from files relative to `src/routes`. */
export function buildRoutes(
  routeFiles: string[],
  repoRelativeRoutesDir = "src/routes",
): RouteEntry[] {
  const parsed = routeFiles.flatMap((file) => {
    const route = parseRouteFile(file, repoRelativeRoutesDir);
    return route ? [route] : [];
  });
  // `about.lazy.tsx` and `about.tsx` describe one route: report the main file.
  const byId = new Map<string, ParsedRoute>();
  for (const route of parsed) {
    const existing = byId.get(route.id);
    if (!existing || (existing.lazy && !route.lazy)) byId.set(route.id, route);
  }
  const unique = [...byId.values()];
  return unique.map((route) => ({
    file: route.file,
    segments: route.segments,
    isParent:
      route.id !== "" &&
      unique.some((other) => other.id.startsWith(`${route.id}/`)),
  }));
}

function listRouteFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory()
        ? listRouteFiles(path.join(dir, entry.name), relative)
        : [relative];
    });
}

export function loadRoutes(repo: string): RouteEntry[] {
  const routesDir = path.join(repo, "src", "routes");
  if (!existsSync(routesDir)) {
    throw new Error(`No src/routes directory in ${repo}`);
  }
  return buildRoutes(listRouteFiles(routesDir));
}

type RouteMatch = { route: RouteEntry; params: Record<string, string> };

function matchSegments(
  segments: RouteSegment[],
  url: string[],
  params: Record<string, string>,
): Record<string, string> | null {
  const [segment, ...rest] = segments;
  if (!segment) return url.length === 0 ? params : null;
  const [head, ...tail] = url;
  if (segment.kind === "splat") {
    return rest.length === 0 ? { ...params, _splat: url.join("/") } : null;
  }
  if (segment.kind === "static") {
    return head === segment.value ? matchSegments(rest, tail, params) : null;
  }
  if (head !== undefined) {
    const consumed = matchSegments(rest, tail, {
      ...params,
      [segment.value]: head,
    });
    if (consumed) return consumed;
  }
  return segment.kind === "optional" ? matchSegments(rest, url, params) : null;
}

// Static beats param beats optional beats splat, position by position.
function compareSpecificity(a: RouteEntry, b: RouteEntry): number {
  const length = Math.max(a.segments.length, b.segments.length);
  for (let i = 0; i < length; i += 1) {
    const rankA = a.segments[i] ? KIND_RANK[a.segments[i].kind] : 4;
    const rankB = b.segments[i] ? KIND_RANK[b.segments[i].kind] : 4;
    if (rankA !== rankB) return rankA - rankB;
  }
  return 0;
}

export function matchPath(
  routes: RouteEntry[],
  pathname: string,
): RouteMatch | null {
  const url = pathname.split("/").filter(Boolean);
  const matches = routes.flatMap((route) => {
    // Layouts only stand in for a page when they own a real path.
    if (route.isParent && route.segments.length === 0) return [];
    const params = matchSegments(route.segments, url, {});
    return params ? [{ route, params }] : [];
  });
  matches.sort(
    (a, b) =>
      Number(a.route.isParent) - Number(b.route.isParent) ||
      compareSpecificity(a.route, b.route),
  );
  return matches[0] ?? null;
}

/**
 * The MDX behind a dynamic route: `src/content/<dir>/<slug>.<lang>.mdx`, else
 * `<slug>.mdx`, where `<dir>` is the static path run just before the slug
 * param (falling back to its last segment, then the content root).
 */
export function findContentFile(
  repo: string,
  match: RouteMatch,
): string | null {
  const { segments } = match.route;
  const params = segments.filter((segment) => segment.kind === "param");
  const slugSegment =
    params.find((segment) => segment.value === "slug") ??
    [...params]
      .reverse()
      .find((segment) => !LANGUAGE_PARAMS.has(segment.value));
  const slug = slugSegment ? match.params[slugSegment.value] : undefined;
  if (!slugSegment || !slug) return null;

  // The static run of segments right before the slug names the content dir.
  const run: string[] = [];
  for (const segment of segments
    .slice(0, segments.indexOf(slugSegment))
    .reverse()) {
    if (segment.kind !== "static") break;
    run.unshift(segment.value);
  }
  const directories = [...new Set([run.join("/"), run.at(-1) ?? "", ""])];

  const languageSegment = segments.find(
    (segment) =>
      (segment.kind === "param" || segment.kind === "optional") &&
      LANGUAGE_PARAMS.has(segment.value),
  );
  const language = languageSegment
    ? match.params[languageSegment.value]
    : undefined;
  const names = [
    ...(language ? [`${slug}.${language}.mdx`] : []),
    `${slug}.mdx`,
  ];
  for (const directory of directories) {
    for (const name of names) {
      const relative = path.posix.join("src/content", directory, name);
      if (existsSync(path.join(repo, relative))) return relative;
    }
  }
  return null;
}

function toPathname(rawUrl: string): string {
  const pathname = new URL(rawUrl, "http://site.invalid").pathname;
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export function mapUrls(repo: string, urls: string[]): MappedUrl[] {
  const routes = loadRoutes(repo);
  return urls.map((url) => {
    let match: RouteMatch | null = null;
    try {
      match = matchPath(routes, toPathname(url));
    } catch {
      match = null;
    }
    if (!match) {
      return { url, routeFile: null, contentFile: null, status: "unmatched" };
    }
    const dynamic = match.route.segments.some(
      (segment) => segment.kind !== "static",
    );
    return {
      url,
      routeFile: match.route.file,
      contentFile: dynamic ? findContentFile(repo, match) : null,
      status: dynamic ? "dynamic" : "matched",
    };
  });
}

/** `<loc>` entries of a sitemap (urlset or sitemap index). */
export function parseSitemapLocs(xml: string): string[] {
  return [
    ...xml.matchAll(
      /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/g,
    ),
  ].map((match) =>
    match[1]
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'"),
  );
}
