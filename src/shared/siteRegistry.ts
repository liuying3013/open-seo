// Closed value sets for the site registry. Shared by both DB dialect schemas,
// the Zod input schemas, and the overview UI so they cannot drift apart.

export const SITE_ROLES = [
  "brand_main",
  "topical",
  "research",
  "other",
] as const;
export const SITE_OPS_STATUSES = [
  "pending",
  "active",
  "focus",
  "maintenance",
  "paused",
] as const;
export const SITE_HOSTINGS = ["coolify", "external", "unknown"] as const;
export const SITE_TEMPLATE_FAMILIES = [
  "tanstack",
  "astro",
  "blog",
  "nextjs_sanity",
  "other",
] as const;
export const SITE_CONTENT_FORMATS = [
  "mdx",
  "tsx",
  "mixed",
  "cms",
  "unknown",
] as const;

/**
 * Canonical form used to match a site to a project: lowercase host with the
 * protocol, `www.`, port, path, query and trailing slash removed. Returns null
 * for input that is not a plausible hostname.
 */
export function normalizeSiteDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const withoutProtocol = trimmed.replace(/^[a-z][a-z\d+.-]*:\/\//, "");
  const host = withoutProtocol
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  const isHost = /^[a-z\d]([a-z\d-]*[a-z\d])?(\.[a-z\d]([a-z\d-]*[a-z\d])?)+$/;
  return isHost.test(host) ? host : null;
}

/**
 * Plausible column of the sites overview: no site mapped, a site mapped but no
 * API key on the server to read it, or fully connected.
 */
export function plausibleStatus(
  plausibleSite: string | null | undefined,
  apiKeyConfigured: boolean,
): "not_configured" | "unconnected" | "connected" {
  if (!plausibleSite) return "not_configured";
  return apiKeyConfigured ? "connected" : "unconnected";
}
