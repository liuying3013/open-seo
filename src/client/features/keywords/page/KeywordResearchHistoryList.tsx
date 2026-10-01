import { Database, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { IntentBadge } from "@/client/features/keywords/components/IntentBadge";
import { toKeywordIntent } from "@/client/features/keywords/keywordResearchTypes";
import {
  formatCompactNumber,
  formatNumber,
  LOCATIONS,
} from "@/client/features/keywords/utils";
import type { ResearchedKeywordRow } from "@/types/keywords";

type Props = {
  projectId: string;
  rows: ResearchedKeywordRow[];
  totalCount: number;
};

export function KeywordResearchHistoryList({
  projectId,
  rows,
  totalCount,
}: Props) {
  if (rows.length === 0) return null;

  return (
    <section
      data-testid="keyword-research-history-list"
      className="rounded-2xl border border-base-300 bg-base-100 p-5 md:p-6"
    >
      <div className="mb-4 flex items-start gap-2">
        <Database className="mt-0.5 size-4 shrink-0 text-base-content/45" />
        <div className="min-w-0">
          <p className="text-sm text-base-content/80">
            {rows.length === totalCount
              ? `${totalCount} previously researched keyword${totalCount === 1 ? "" : "s"}`
              : `Latest ${rows.length} of ${formatNumber(totalCount)} previously researched keywords`}
          </p>
          <p className="text-xs text-base-content/50">
            Stored metrics from past Keyword Research and scans. Researching
            again uses credits.
          </p>
        </div>
      </div>
      <div className="grid gap-2">
        {rows.map((row) => (
          <HistoryRow key={rowKey(row)} projectId={projectId} row={row} />
        ))}
      </div>
    </section>
  );
}

function HistoryRow({
  projectId,
  row,
}: {
  projectId: string;
  row: ResearchedKeywordRow;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-base-content">{row.keyword}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/60">
          <span>
            Vol{" "}
            <span className="font-medium tabular-nums text-base-content/80">
              {formatCompactNumber(row.searchVolume)}
            </span>
          </span>
          <span>
            CPC{" "}
            <span className="font-medium tabular-nums text-base-content/80">
              {row.cpc == null ? "-" : `$${row.cpc.toFixed(2)}`}
            </span>
          </span>
          <span>
            KD{" "}
            <span className="font-medium tabular-nums text-base-content/80">
              {row.keywordDifficulty ?? "-"}
            </span>
          </span>
          <IntentBadge intent={toKeywordIntent(row.intent)} />
          <span>{LOCATIONS[row.locationCode] || row.locationCode}</span>
          <span>
            {new Date(row.fetchedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        </p>
      </div>
      <Link
        from="/p/$projectId/keywords"
        to="/p/$projectId/keywords"
        params={{ projectId }}
        search={{
          q: row.keyword,
          loc: row.locationCode,
        }}
        replace
        className="btn btn-ghost btn-xs shrink-0 gap-1 text-base-content/60"
        title={`Research ${row.keyword}`}
      >
        <Search className="size-3" />
        Research
      </Link>
    </div>
  );
}

function rowKey(row: ResearchedKeywordRow) {
  return `${row.keyword}:${row.locationCode}:${row.languageCode}`;
}
