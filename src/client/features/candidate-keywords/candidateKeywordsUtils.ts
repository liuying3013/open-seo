import { sort } from "remeda";
import type { CandidateKeywordRow } from "@/types/keywords";

const SOURCE_LABELS: Record<string, string> = {
  competitor: "Competitor",
  manual: "Manual",
  gsc: "GSC",
  whatsapp: "WhatsApp",
  rfq: "RFQ",
  sales: "Sales",
  import: "Import",
  paa: "PAA",
  related: "Related",
  product_db: "Product DB",
  seed_expansion: "Seed expansion",
  opportunity: "Opportunity",
};

export const EMPTY_CANDIDATE_ROWS: CandidateKeywordRow[] = [];

export const CANDIDATE_PAGE_SIZES = [25, 50, 100] as const;
export type CandidatePageSize = (typeof CANDIDATE_PAGE_SIZES)[number];

export function sourceLabel(source: string | null): string {
  if (!source) return "Unknown";
  return SOURCE_LABELS[source] ?? source;
}

export function sourceBadgeClass(source: string | null): string {
  switch (source) {
    case "competitor":
      return "badge-info";
    case "manual":
      return "badge-neutral";
    case "gsc":
      return "badge-success";
    case "opportunity":
      return "badge-warning";
    default:
      return "badge-ghost";
  }
}

export function formatAddedOn(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString();
}

export function parseCandidateDraft(draft: string): string[] {
  return [
    ...new Set(
      draft
        .split(/\n|,/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
  ];
}

function sourceKey(source: string | null): string {
  return source ?? "unknown";
}

export function countBySource(
  rows: CandidateKeywordRow[],
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = sourceKey(row.source);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return sort([...counts.entries()], (a, b) => a[0].localeCompare(b[0]));
}

export function filterCandidateRows(
  rows: CandidateKeywordRow[],
  search: string,
  sourceFilter: string,
): CandidateKeywordRow[] {
  const needle = search.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (sourceFilter !== "all" && sourceKey(row.source) !== sourceFilter) {
      return false;
    }
    return (
      needle.length === 0 || row.keyword.toLocaleLowerCase().includes(needle)
    );
  });
}
