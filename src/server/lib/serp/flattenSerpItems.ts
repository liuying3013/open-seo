import type { SerpLiveItem } from "@/server/lib/dataforseo/serp";
import { NON_RESULT_ITEM_TYPES, RESULT_TYPE_BY_ITEM_TYPE } from "./platformMap";

// Generic SERP flattening shared by every feature that persists SERP rows.
// Container items (PAA, discussions, AI overview) contribute their linked
// children as rows at the container's absolute rank so positional weighting
// sees where Google placed the block. Feature-specific decoration (platform,
// content type, owned/competitor flags) happens in the callers.

type FlattenedSerpRow = {
  rank: number;
  url: string;
  domain: string;
  title: string | null;
  description: string | null;
  resultType: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function flattenSerpItems(items: SerpLiveItem[]): {
  rows: FlattenedSerpRow[];
  features: string[];
  relatedSearches: string[];
} {
  const rows: FlattenedSerpRow[] = [];
  const features = new Set<string>();
  const relatedSearches: string[] = [];

  let fallbackRank = 0;
  for (const item of items) {
    features.add(item.type);
    fallbackRank += 1;
    const rank = item.rank_absolute ?? item.rank_group ?? fallbackRank;
    const resultType = RESULT_TYPE_BY_ITEM_TYPE[item.type] ?? item.type;

    if (item.type === "related_searches") {
      const children = Array.isArray(item.items) ? item.items : [];
      for (const child of children) {
        if (typeof child === "string") relatedSearches.push(child);
      }
      continue;
    }
    if (NON_RESULT_ITEM_TYPES.has(item.type)) continue;

    if (item.url && item.domain) {
      rows.push({
        rank,
        url: item.url,
        domain: item.domain,
        title: item.title ?? null,
        description: item.description ?? null,
        resultType,
      });
      continue;
    }

    // Container without its own URL: extract linked children generically.
    const children = Array.isArray(item.items) ? item.items : [];
    for (const child of children) {
      if (!isRecord(child)) continue;
      const c = child;
      // PAA children nest their answer link one level deeper.
      const expandedRaw: unknown = Array.isArray(c.expanded_element)
        ? c.expanded_element[0]
        : c.expanded_element;
      const expanded = isRecord(expandedRaw) ? expandedRaw : null;
      const url =
        (typeof c.url === "string" && c.url) ||
        (expanded && typeof expanded.url === "string" && expanded.url) ||
        null;
      const domain =
        (typeof c.domain === "string" && c.domain) ||
        (expanded && typeof expanded.domain === "string" && expanded.domain) ||
        (url ? new URL(url).hostname : null);
      if (!url || !domain) continue;
      const title =
        (typeof c.title === "string" && c.title) ||
        (typeof c.question === "string" && c.question) ||
        null;
      rows.push({
        rank,
        url,
        domain,
        title,
        description: typeof c.description === "string" ? c.description : null,
        resultType,
      });
    }
  }

  return { rows, features: [...features], relatedSearches };
}
