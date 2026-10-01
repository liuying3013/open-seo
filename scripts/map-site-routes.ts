/**
 * Maps a TanStack Router site's live URLs to source files.
 *
 * Usage:
 *   pnpm exec tsx scripts/map-site-routes.ts --repo <path> --sitemap <url|file>
 *   pnpm exec tsx scripts/map-site-routes.ts --repo <path> --urls <file>
 *
 * --urls takes one URL (or path) per line; blank lines and `#` comments are
 * ignored. A sitemap index is followed when its children are http(s) URLs.
 * Prints a JSON array of { url, routeFile, contentFile, status } to stdout.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "./cli-utils";
import { mapUrls, parseSitemapLocs } from "./site-route-map";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_SITEMAPS = 50;

async function readSource(source: string): Promise<string> {
  if (!/^https?:\/\//i.test(source)) return readFileSync(source, "utf8");
  const response = await fetch(source, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Fetching ${source} failed: HTTP ${response.status}`);
  }
  return response.text();
}

async function collectSitemapUrls(source: string): Promise<string[]> {
  const queue = [source];
  const seen = new Set<string>();
  const urls: string[] = [];
  while (queue.length > 0 && seen.size < MAX_SITEMAPS) {
    const next = queue.shift();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    const xml = await readSource(next);
    const locs = parseSitemapLocs(xml);
    if (/<sitemapindex[\s>]/i.test(xml)) {
      queue.push(...locs.filter((loc) => /^https?:\/\//i.test(loc)));
    } else {
      urls.push(...locs);
    }
  }
  return urls;
}

function readUrlList(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo;
  if (!repo || (!args.sitemap && !args.urls)) {
    console.error(
      "Usage: map-site-routes.ts --repo <path> (--sitemap <url|file> | --urls <file>)",
    );
    process.exitCode = 2;
    return;
  }
  const urls = args.sitemap
    ? await collectSitemapUrls(args.sitemap)
    : readUrlList(args.urls);
  const mapped = mapUrls(path.resolve(repo), [...new Set(urls)]);
  console.log(JSON.stringify(mapped, null, 2));
  const count = (status: string) =>
    mapped.filter((item) => item.status === status).length;
  console.error(
    `${mapped.length} URLs: ${count("matched")} matched, ${count("dynamic")} dynamic, ${count("unmatched")} unmatched`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
