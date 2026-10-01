// Live verification: fetch the published URL and compare it with the approved draft.

import * as cheerio from "cheerio";
import { textMatchScore, type ApprovedDraftText } from "./text-match";

const RETRY_INTERVAL_MS = 20_000;
export const MATCH_TARGET = 85;

const BLOCK_ELEMENTS =
  "p, div, h1, h2, h3, h4, h5, h6, li, ul, ol, tr, td, th, br, section, article, header, footer, main, nav, aside, blockquote, pre, dt, dd, figcaption, table, form";

export type LiveResult = {
  statusCode: number | null;
  noindex: boolean;
  canonical: string | null;
  textMatch: number;
  notes: string;
};

/** Pure: parse a fetched page into the facts the server needs. */
export function inspectPage(
  html: string,
  headers: { get(name: string): string | null },
  draft: ApprovedDraftText | null,
): Omit<LiveResult, "statusCode" | "notes"> {
  const $ = cheerio.load(html);
  const robots = $('meta[name="robots" i], meta[name="googlebot" i]')
    .map((_, el) => $(el).attr("content") ?? "")
    .get()
    .join(",");
  const noindex =
    /\b(?:noindex|none)\b/i.test(headers.get("x-robots-tag") ?? "") ||
    /\b(?:noindex|none)\b/i.test(robots);
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || null;
  return {
    noindex,
    canonical,
    textMatch: draft ? textMatchScore(draft, visibleText($)) : 0,
  };
}

/** The body text a reader sees. Removes non-rendered elements from `$`. */
export function visibleText($: cheerio.CheerioAPI): string {
  // The score is coverage of the approved text, so surrounding page chrome
  // (nav, footer) does no harm; only non-rendered text is dropped.
  $("script, style, noscript, template").remove();
  // Without a separator, adjacent blocks would glue into one word.
  $(BLOCK_ELEMENTS).after("\n");
  return $("body").text();
}

async function fetchOnce(
  url: string,
  draft: ApprovedDraftText | null,
): Promise<LiveResult> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "openseo-publisher/1.0",
      "cache-control": "no-cache",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const html = await response.text();
  const page = inspectPage(html, response.headers, draft);
  return { statusCode: response.status, notes: "", ...page };
}

/**
 * Fetch the page until it passes (200, indexable, text match at the target) or
 * the time runs out; caches and slow rollouts mean the first fetches may be
 * stale. Returns the best last observation. Without a draft (rollback) a
 * single 200/404 observation is enough.
 */
export async function verifyLive(
  url: string,
  draft: ApprovedDraftText | null,
  maxWaitMs: number,
): Promise<LiveResult> {
  const deadline = Date.now() + maxWaitMs;
  let last: LiveResult = {
    statusCode: null,
    noindex: false,
    canonical: null,
    textMatch: 0,
    notes: "No response.",
  };
  for (;;) {
    try {
      last = await fetchOnce(url, draft);
      const passed =
        last.statusCode === 200 &&
        !last.noindex &&
        (!draft || last.textMatch >= MATCH_TARGET);
      if (passed || !draft) return last;
    } catch (error) {
      last = {
        ...last,
        notes: error instanceof Error ? error.message : String(error),
      };
    }
    if (Date.now() + RETRY_INTERVAL_MS > deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }
}
