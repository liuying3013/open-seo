import * as React from "react";
import { sort } from "remeda";
import { IntentBadge } from "@/client/features/keywords/components/IntentBadge";
import { SerpResultsTable } from "@/client/features/keywords/components/SerpResultsTable";
import { formatNumber } from "@/client/features/keywords/utils";
import type { KeywordIntent } from "@/types/keywords";
import type { DetailData } from "@/client/features/opportunity-intel/detailData";

/** Fine discovery intents → the shared 4-way badge vocabulary. */
function coarseIntent(intent: string | null): KeywordIntent {
  switch (intent) {
    case "informational":
    case "problem":
      return "informational";
    case "transactional":
      return "transactional";
    case "navigational":
      return "navigational";
    case "commercial":
    case "service":
    case "supplier":
    case "replacement":
    case "model":
      return "commercial";
    default:
      return "unknown";
  }
}

/** Fine intents that carry extra meaning beyond the 4-way badge. */
const FINE_INTENT_NOTE = new Set([
  "service",
  "supplier",
  "replacement",
  "model",
  "problem",
]);

/** One row per keyword text (markets collapse), highest volume first. */
export function dedupeKeywords(keywords: DetailData["keywords"]) {
  return sort(
    [...new Map(keywords.map((row) => [row.keyword, row])).values()],
    (a, b) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1),
  );
}

function gapBadgeClass(gapScore: number | null): string {
  if (gapScore === null) return "badge-ghost";
  if (gapScore >= 40) return "badge-success";
  if (gapScore >= 25) return "badge-warning";
  return "badge-ghost";
}

export function KeywordsCard({
  keywords,
}: {
  keywords: DetailData["keywords"];
}) {
  const [keywordFilter, setKeywordFilter] = React.useState("");
  const deduped = dedupeKeywords(keywords);
  const filtered = keywordFilter
    ? deduped.filter((row) =>
        row.keyword.includes(keywordFilter.toLowerCase().trim()),
      )
    : deduped;
  return (
    <div className="rounded-lg border border-base-300 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Keywords ({filtered.length}
          {keywordFilter ? ` / ${deduped.length}` : ""})
        </h3>
        <input
          type="search"
          placeholder="Filter…"
          className="input input-sm input-bordered w-36"
          value={keywordFilter}
          onChange={(event) => setKeywordFilter(event.target.value)}
        />
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="table table-xs">
          <thead className="sticky top-0 bg-base-100">
            <tr className="text-xs text-base-content/60">
              <th>Keyword</th>
              <th>Intent</th>
              <th className="text-right">Volume</th>
              <th className="text-right">CPC</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td className="max-w-56 truncate" title={row.keyword}>
                  {row.keyword}
                </td>
                <td>
                  <span className="flex items-center gap-1.5">
                    <IntentBadge intent={coarseIntent(row.intent)} />
                    {row.intent && FINE_INTENT_NOTE.has(row.intent) ? (
                      <span className="text-xs text-base-content/50">
                        {row.intent}
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="text-right tabular-nums">
                  {row.metricsFetchedAt
                    ? formatNumber(row.searchVolume ?? 0)
                    : "…"}
                </td>
                <td className="text-right tabular-nums">
                  {row.cpc !== null ? `$${row.cpc.toFixed(2)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SerpEvidenceCard({
  snapshots,
}: {
  snapshots: DetailData["snapshots"];
}) {
  return (
    <div className="rounded-lg border border-base-300 p-4">
      <h3 className="mb-2 text-sm font-semibold">
        SERP evidence ({snapshots.length} snapshots)
      </h3>
      <div className="max-h-96 space-y-3 overflow-auto">
        {snapshots.map((entry) => (
          <details key={entry.snapshot.id} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
              <span
                className={`badge badge-sm tabular-nums ${gapBadgeClass(entry.snapshot.gapScore)}`}
              >
                gap {entry.snapshot.gapScore ?? "…"}
              </span>
              <span className="truncate font-medium">
                “{entry.snapshot.keyword}”
              </span>
              <span className="ml-auto text-xs text-base-content/40 group-open:hidden">
                show results
              </span>
            </summary>
            <div className="mt-2">
              <SerpResultsTable
                items={entry.results
                  .filter((result) => result.rank <= 10)
                  .slice(0, 10)
                  .map((result) => ({
                    rank: result.rank,
                    title: result.title,
                    url: result.url,
                    domain: result.domain,
                    pageClass: result.pageClass,
                  }))}
              />
            </div>
          </details>
        ))}
        {snapshots.length === 0 ? (
          <p className="text-sm text-base-content/60">No SERP snapshots yet.</p>
        ) : null}
      </div>
    </div>
  );
}
