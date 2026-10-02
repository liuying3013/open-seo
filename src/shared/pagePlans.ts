// Closed value sets and URL helpers for the page inventory and the monthly page
// plan. Shared by both DB dialect schemas, the Zod input schemas and the UI.

export const PAGE_ACTIONS = [
  "new",
  "update",
  "add_section",
  "merge",
  "watch",
  "exclude",
] as const;
type PageAction = (typeof PAGE_ACTIONS)[number];

// Actions that produce a page work order when a plan is approved. watch and
// exclude are decisions to leave the page alone.
export const WORK_ORDER_ACTIONS: readonly PageAction[] = [
  "new",
  "update",
  "add_section",
  "merge",
];

export const PAGE_ROLES = ["hub", "spoke", "money", "other"] as const;
// "publish": added by the publisher once a page it published was verified live.
export const SITE_PAGE_SOURCES = [
  "sitemap",
  "manual",
  "crawl",
  "publish",
] as const;
export const PAGE_PLAN_STATUSES = ["draft", "approved", "rejected"] as const;

export const PAGE_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Canonical absolute form of a page URL: https, lowercase host, default port,
 * fragment and trailing slash (except the root) removed, query kept. A path
 * ("/ar/foo") is resolved against `siteDomain`. Returns null when the input is
 * not a usable http(s) URL.
 */
export function normalizePageUrl(
  input: string,
  siteDomain?: string | null,
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    if (trimmed.startsWith("/")) {
      if (!siteDomain) return null;
      url = new URL(trimmed, `https://${siteDomain}`);
    } else {
      url = new URL(trimmed);
    }
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  url.protocol = "https:";
  url.hash = "";
  const path =
    url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  return `${url.origin}${path}${url.search}`;
}

/** True when the URL's host is the site domain or one of its subdomains. */
export function isUrlOnSite(url: string, siteDomain: string): boolean {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return host === siteDomain || host.endsWith(`.${siteDomain}`);
}

export function pathOfUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}
