import { ExternalLink } from "lucide-react";

/** The minimum a SERP row needs to render; `pageClass` is opportunity-only. */
type SerpResultRowView = {
  rank: number;
  title: string | null;
  url: string;
  domain: string;
  pageClass?: string | null;
};

/**
 * The shared "# / Page" SERP listing used by Keyword Research's SERP Analysis
 * card and by the opportunity funnel's stored SERP evidence, so live and
 * archived results read identically.
 */
export function SerpResultsTable({ items }: { items: SerpResultRowView[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-xs w-full">
        <thead>
          <tr className="text-xs text-base-content/60">
            <th className="w-8">#</th>
            <th>Page</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={`${item.rank}-${item.url}`}
              className="hover:bg-base-200/50"
            >
              <td className="font-mono text-xs text-base-content/50">
                {item.rank}
              </td>
              <td className="min-w-0 max-w-0">
                <div className="flex flex-col gap-0.5">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 truncate font-medium text-primary hover:underline"
                    title={item.title ?? item.url}
                  >
                    {item.title || item.url}
                    <ExternalLink className="size-3 shrink-0 opacity-40" />
                  </a>
                  <span className="flex items-center gap-1.5 truncate text-xs text-base-content/40">
                    {item.domain}
                    {item.pageClass ? (
                      <span className="badge badge-ghost badge-xs">
                        {item.pageClass}
                      </span>
                    ) : null}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
