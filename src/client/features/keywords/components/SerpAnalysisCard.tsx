import { ChevronLeft, ChevronRight } from "lucide-react";
import { ExportToSheetsButton } from "@/client/components/table/ExportToSheetsButton";
import type { SerpResultItem } from "@/types/keywords";
import { SerpResultsTable } from "./SerpResultsTable";

export function SerpAnalysisCard({
  items,
  keyword,
  loading,
  loadingMore,
  canLoadMore,
  error,
  onRetry,
  deepFetchFailed,
  page,
  pageSize,
  onPageChange,
}: {
  items: SerpResultItem[];
  keyword?: string | null;
  loading: boolean;
  /** A deeper snapshot is being fetched; `items` is still the shallow one. */
  loadingMore: boolean;
  /** Paging past the loaded results can buy a deeper snapshot. */
  canLoadMore: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** The failure was the deeper crawl, so retrying restores the shallow one. */
  deepFetchFailed: boolean;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(items.length / pageSize);
  const pageItems = items.slice(page * pageSize, (page + 1) * pageSize);

  if (loading) return <SerpAnalysisLoadingState />;
  if (error) {
    return (
      <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error space-y-2">
        <p>{error}</p>
        {onRetry ? (
          <button className="btn btn-xs" onClick={onRetry}>
            {deepFetchFailed ? "Show top 20" : "Retry"}
          </button>
        ) : null}
      </div>
    );
  }
  if (items.length === 0) return <SerpAnalysisEmptyState keyword={keyword} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-base-content/50">
          {items.length} organic results
        </div>
        <ExportToSheetsButton
          headers={["Rank", "Title", "URL", "Domain"]}
          rows={items.map((item) => [
            item.rank,
            item.title ?? "",
            item.url,
            item.domain,
          ])}
          feature="serp_analysis"
        />
      </div>
      {pageItems.length === 0 && loadingMore ? (
        <SerpAnalysisLoadingState />
      ) : (
        <SerpResultsTable items={pageItems} />
      )}
      <SerpAnalysisPagination
        page={page}
        totalPages={totalPages}
        loadingMore={loadingMore}
        canLoadMore={canLoadMore}
        onPageChange={onPageChange}
      />
    </div>
  );
}

function SerpAnalysisPagination({
  page,
  totalPages,
  loadingMore,
  canLoadMore,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  loadingMore: boolean;
  canLoadMore: boolean;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1 && !canLoadMore) return null;

  // Past the loaded results, "Next" stops being free paging and buys a deeper
  // crawl — say so on the button rather than spending silently.
  const nextBuysDeeperSnapshot =
    canLoadMore && !loadingMore && page >= totalPages - 1;

  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-base-200">
      <span className="text-xs text-base-content/50">
        {loadingMore ? (
          "Loading more results…"
        ) : (
          <>
            Page {page + 1} of {totalPages}
          </>
        )}
      </span>
      <div className="flex gap-1">
        <button
          className="btn btn-ghost btn-xs"
          disabled={page === 0 || loadingMore}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-3.5" />
          Prev
        </button>
        <button
          className="btn btn-ghost btn-xs"
          disabled={loadingMore || (page >= totalPages - 1 && !canLoadMore)}
          onClick={() => onPageChange(page + 1)}
        >
          {nextBuysDeeperSnapshot ? "Load top 100" : "Next"}
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function SerpAnalysisLoadingState() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="h-8 rounded bg-base-200 animate-pulse"
          style={{ animationDelay: `${index * 50}ms` }}
        />
      ))}
    </div>
  );
}

function SerpAnalysisEmptyState({ keyword }: { keyword?: string | null }) {
  return (
    <div className="text-sm text-base-content/50 text-center py-8">
      <p>No SERP details available for this keyword yet.</p>
      {keyword ? (
        <p className="mt-1">Try clicking another keyword to load data.</p>
      ) : null}
    </div>
  );
}
