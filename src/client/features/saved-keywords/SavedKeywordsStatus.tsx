import { Globe, Loader2 } from "lucide-react";

export function SavedKeywordsStatus({
  totalCount,
  isFetching,
  storedSerpCount,
}: {
  totalCount: number;
  isFetching: boolean;
  /** Keywords in this project carrying an archived SERP from the funnel. */
  storedSerpCount?: number;
}) {
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-base-content/60">
      <span>
        {totalCount.toLocaleString()} saved keyword
        {totalCount === 1 ? "" : "s"}
      </span>
      {storedSerpCount ? (
        <span className="flex items-center gap-1">
          <Globe className="size-3" />
          {storedSerpCount} with archived SERP
        </span>
      ) : null}
      {isFetching ? <Loader2 className="size-3 animate-spin" /> : null}
    </div>
  );
}
