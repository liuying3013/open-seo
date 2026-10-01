import { normalizeSiteDomain } from "@/shared/siteRegistry";

export type GscPropertyCandidate = {
  accountId: string;
  accountEmail: string | null;
  siteUrl: string;
  permissionLevel: string;
};

export type GscMatchFailure = "no_matching_property" | "unverified_only";

const UNVERIFIED = "siteUnverifiedUser";
const PERMISSION_RANK: Record<string, number> = {
  siteOwner: 3,
  siteFullUser: 2,
  siteRestrictedUser: 1,
};

/**
 * How well a property covers a whole site: 0 = domain property
 * (`sc-domain:example.com`), 1 = `https://example.com/`, 2 =
 * `https://www.example.com/`, null = not a match (other host, http, or a
 * URL-prefix property scoped to a sub-path).
 */
function propertyRank(domain: string, siteUrl: string): number | null {
  if (siteUrl.startsWith("sc-domain:")) {
    return normalizeSiteDomain(siteUrl.slice("sc-domain:".length)) === domain
      ? 0
      : null;
  }
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.pathname !== "/") return null;
  if (url.hostname === domain) return 1;
  return url.hostname === `www.${domain}` ? 2 : null;
}

/**
 * Picks the property that covers `domain`: domain property first, then the
 * https apex, then https www. Verified properties only; ties go to the higher
 * permission level, then to the first account listed.
 */
export function pickPropertyForDomain(
  domain: string,
  candidates: GscPropertyCandidate[],
): { match: GscPropertyCandidate } | { failure: GscMatchFailure } {
  const covering = candidates.flatMap((candidate) => {
    const rank = propertyRank(domain, candidate.siteUrl);
    return rank === null ? [] : [{ candidate, rank }];
  });
  const verified = covering.filter(
    (entry) => entry.candidate.permissionLevel !== UNVERIFIED,
  );
  if (verified.length === 0) {
    return {
      failure: covering.length > 0 ? "unverified_only" : "no_matching_property",
    };
  }
  let best = verified[0];
  for (const entry of verified.slice(1)) {
    const better =
      entry.rank < best.rank ||
      (entry.rank === best.rank &&
        (PERMISSION_RANK[entry.candidate.permissionLevel] ?? 0) >
          (PERMISSION_RANK[best.candidate.permissionLevel] ?? 0));
    if (better) best = entry;
  }
  return { match: best.candidate };
}
