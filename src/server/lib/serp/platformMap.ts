// Mechanical SERP classification: DataForSEO item types -> our result types,
// and result domains -> third-party platforms. Pure lookups, no LLM.

/** Maps a result's domain to a known third-party platform, else null. */
export function platformForDomain(domain: string): string | null {
  const host = domain.toLowerCase().replace(/^www\./, "");
  const bare = host.split(":")[0];
  for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS)) {
    if (hosts.some((h) => bare === h || bare.endsWith(`.${h}`))) {
      return platform;
    }
  }
  return null;
}

const PLATFORM_HOSTS: Record<string, string[]> = {
  reddit: ["reddit.com"],
  quora: ["quora.com"],
  youtube: ["youtube.com", "youtu.be"],
  medium: ["medium.com"],
  pinterest: ["pinterest.com", "pinterest.co.uk", "pinterest.de"],
  linkedin: ["linkedin.com"],
  slideshare: ["slideshare.net"],
  scribd: ["scribd.com"],
  issuu: ["issuu.com"],
  github: ["github.com", "gist.github.com"],
  devto: ["dev.to"],
  facebook: ["facebook.com"],
  x: ["x.com", "twitter.com"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
};

/**
 * DataForSEO item type -> stored result_type. Container children (PAA
 * questions, forum links) are flattened by the fetch service and inherit the
 * mapped child type. Unlisted item types pass through verbatim.
 */
export const RESULT_TYPE_BY_ITEM_TYPE: Record<string, string> = {
  organic: "organic",
  featured_snippet: "featured_snippet",
  video: "video",
  images: "image",
  people_also_ask: "people_also_ask",
  people_also_ask_element: "people_also_ask",
  people_also_ask_expanded_element: "people_also_ask",
  discussions_and_forums: "discussion",
  ai_overview: "ai_overview",
  ai_overview_reference: "ai_overview",
  related_searches: "related_searches",
  shopping: "shopping",
  local_pack: "local_pack",
  top_stories: "news",
  knowledge_graph: "knowledge_graph",
};

/** Item types that describe the SERP but are not rankable result rows. */
export const NON_RESULT_ITEM_TYPES = new Set(["related_searches"]);

/**
 * Cheap heuristic content-type guess from URL + title, filled at fetch time;
 * analyze_cluster's LLM pass refines organic rows it disagrees with. Returns
 * null when nothing matches (the LLM pass decides).
 */
export function heuristicContentType(input: {
  resultType: string;
  url: string;
  title: string | null;
  platform: string | null;
}): string | null {
  if (input.resultType === "video" || input.platform === "youtube") {
    return "video";
  }
  if (input.resultType === "discussion" || input.platform === "reddit") {
    return "forum_thread";
  }
  if (input.resultType === "people_also_ask" || input.platform === "quora") {
    return "qna";
  }
  const url = input.url.toLowerCase();
  const title = (input.title ?? "").toLowerCase();
  if (url.endsWith(".pdf")) return "pdf";
  if (/(^|\W)(vs\.?|versus)(\W|$)/.test(title) || url.includes("-vs-")) {
    return "comparison";
  }
  if (
    /\b(best|top)\s+\d+\b/.test(title) ||
    /\btop\s+(best\s+)?\w+/.test(title)
  ) {
    return "listicle";
  }
  if (
    /\b(how to|guide|tutorial|what is|explained)\b/.test(title) ||
    url.includes("/blog/") ||
    url.includes("/guide")
  ) {
    return "guide";
  }
  if (url.includes("/product") || url.includes("/p/")) return "product";
  if (url.includes("/category") || url.includes("/collections/")) {
    return "category";
  }
  return null;
}
