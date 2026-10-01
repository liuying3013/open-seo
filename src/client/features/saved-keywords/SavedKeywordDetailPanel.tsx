import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { DifficultyBadge } from "@/client/features/domain/components/DifficultyBadge";
import {
  IntentBadge,
  SerpResultsTable,
} from "@/client/features/keywords/components";
import { AreaTrendChart } from "@/client/features/keywords/components/DisplayPrimitives";
import { toKeywordIntent } from "@/client/features/keywords/keywordResearchTypes";
import type { SavedKeywordRow } from "@/types/keywords";
import { getStoredSerpForKeyword } from "@/serverFunctions/opportunity-intel";
import { LOCATIONS } from "@/shared/keyword-locations";
import { TagChip } from "./TagChip";
import { formatSavedKeywordNumber } from "./savedKeywordsUtils";

/**
 * Zero-cost detail view of a saved keyword: everything already stored locally
 * (metrics, trend, tags). Running the FULL research (related keywords + live
 * SERP) is a separate, explicit, charged action.
 */
export function SavedKeywordDetailPanel({
  row,
  onClose,
}: {
  row: SavedKeywordRow;
  onClose: () => void;
}) {
  // Archived SERP the discovery funnel already paid for (representative
  // keywords only) — a free read, never a new API call.
  const storedSerpQuery = useQuery({
    queryKey: ["stored-serp", row.keyword, row.locationCode],
    queryFn: () =>
      getStoredSerpForKeyword({
        data: { keyword: row.keyword, locationCode: row.locationCode },
      }),
  });
  const storedSerp = storedSerpQuery.data;
  return (
    <div className="rounded-lg border border-base-300 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{row.keyword}</h3>
          <span className="badge badge-ghost badge-sm">
            {LOCATIONS[row.locationCode] ?? row.locationCode} ·{" "}
            {row.languageCode}
          </span>
          <IntentBadge intent={toKeywordIntent(row.intent)} />
          {row.tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} />
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          aria-label="Close keyword details"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-base-content/50">
            Volume
          </div>
          <div className="text-2xl font-bold tabular-nums">
            {formatSavedKeywordNumber(row.searchVolume)}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-base-content/50">
            CPC
          </div>
          <div className="text-2xl font-bold tabular-nums">
            {row.cpc !== null ? `$${row.cpc.toFixed(2)}` : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-base-content/50">
            Competition
          </div>
          <div className="text-2xl font-bold tabular-nums">
            {row.competition !== null ? row.competition.toFixed(2) : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-base-content/50">
            Difficulty
          </div>
          <div className="mt-1">
            <DifficultyBadge value={row.keywordDifficulty} />
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-base-content/50">
            Last fetched
          </div>
          <div className="text-sm text-base-content/70">
            {row.fetchedAt ? row.fetchedAt.slice(0, 10) : "never"}
          </div>
        </div>
      </div>

      {row.monthlySearches.length > 0 ? (
        <div className="mt-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-base-content/50">
            12-month trend
          </div>
          <AreaTrendChart trend={row.monthlySearches} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-base-content/50">
          No stored trend series for this keyword.
        </p>
      )}

      {storedSerp ? (
        <div className="mt-4">
          <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-base-content/50">
            Stored SERP analysis
            <span className="badge badge-ghost badge-xs normal-case">
              fetched {storedSerp.snapshot.fetchedAt.slice(0, 10)}
            </span>
            {storedSerp.snapshot.gapScore !== null ? (
              <span className="badge badge-ghost badge-xs normal-case">
                supply gap {storedSerp.snapshot.gapScore}
              </span>
            ) : null}
          </div>
          <SerpResultsTable
            items={storedSerp.results
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
      ) : storedSerpQuery.isLoading ? (
        <div className="mt-4 flex justify-center py-2">
          <span className="loading loading-spinner loading-sm" />
        </div>
      ) : (
        <p className="mt-4 text-sm text-base-content/50">
          No archived SERP for this keyword (only keywords the funnel already
          fetched a SERP for carry one).
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-base-200 pt-3">
        <p className="text-xs text-base-content/50">
          Shown from stored data — no API call was made.
        </p>
        <Link
          to="/p/$projectId/keywords"
          params={{ projectId: row.projectId }}
          search={{ q: row.keyword, loc: row.locationCode }}
          className="btn btn-outline btn-sm"
        >
          Run full research
          <ExternalLink className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}
