import * as React from "react";
import { sort as sortArray } from "remeda";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Play } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/client/components/Markdown";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { SortableHeader } from "@/client/features/domain/components/SortableHeader";
import { OpportunityDetail } from "@/client/features/opportunity-intel/OpportunityDetail";
import {
  STATUS_BADGE,
  TYPE_LABELS,
} from "@/client/features/opportunity-intel/labels";
import {
  getOpportunityIntelOverview,
  runOpportunityIntelScan,
} from "@/serverFunctions/opportunity-intel";

export const Route = createFileRoute("/_app/opportunities")({
  component: OpportunitiesPage,
});

// Funnel progression for status sorting (mirrors OPPORTUNITY_STATUSES in
// src/server/features/opportunity-intel/stateMachine.ts — keep in sync).
const STATUS_SORT_ORDER = [
  "discovered",
  "keyword_scanned",
  "serp_validated",
  "competitor_validated",
  "buyer_validated",
  "supply_validated",
  "economics_validated",
  "shortlisted",
  "graduated",
  "rejected",
  "watchlist",
  "paused",
];

type OverviewSort = { key: "score" | "status"; order: "asc" | "desc" };

function OpportunitiesPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<OverviewSort | null>(null);
  const overviewQuery = useQuery({
    queryKey: ["opportunity-intel", "overview"],
    queryFn: () => getOpportunityIntelOverview(),
  });
  const overview = overviewQuery.data;

  const scanMutation = useMutation({
    mutationFn: () => runOpportunityIntelScan({ data: {} }),
    onSuccess: (result) => {
      toast.success(
        `Scan ${result.status}: keyword stage ${result.stats.keywordStage.processed}, SERP stage ${result.stats.serpStage.processed}, errors ${result.stats.errors.length}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["opportunity-intel"] });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  // Score defaults to highest-first, status to funnel order; clicking the
  // active header flips direction. Unscored rows always sink to the bottom.
  const toggleSort = (key: OverviewSort["key"]) => {
    setSort((current) =>
      current?.key === key
        ? { key, order: current.order === "asc" ? "desc" : "asc" }
        : { key, order: key === "score" ? "desc" : "asc" },
    );
  };
  const opportunities = React.useMemo(() => {
    const rows = overview?.opportunities ?? [];
    if (!sort) return rows;
    const direction = sort.order === "asc" ? 1 : -1;
    return sortArray(rows, (a, b) => {
      if (sort.key === "score") {
        if (a.latestScore === null && b.latestScore === null) return 0;
        if (a.latestScore === null) return 1;
        if (b.latestScore === null) return -1;
        return (a.latestScore - b.latestScore) * direction;
      }
      const aIndex = STATUS_SORT_ORDER.indexOf(a.status);
      const bIndex = STATUS_SORT_ORDER.indexOf(b.status);
      return (aIndex - bIndex) * direction;
    });
  }, [overview, sort]);

  return (
    <div className="h-full overflow-auto bg-base-100 px-4 py-8 pb-24 md:px-6 md:py-12 md:pb-8">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Opportunities</h1>
            <p className="mt-1 text-sm text-base-content/60">
              The cross-border discovery funnel: seeds are expanded, measured,
              SERP-validated, scored, and reported. Deterministic gates decide;
              you review the shortlist.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm shrink-0"
            disabled={scanMutation.isPending}
            onClick={() => scanMutation.mutate()}
          >
            {scanMutation.isPending ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <Play className="size-4" />
            )}
            Run scan
          </button>
        </div>

        {overviewQuery.isLoading ? (
          <div className="flex justify-center py-10">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : overview ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {Object.entries(overview.counts).map(([status, count]) => (
                <span key={status} className="badge badge-ghost">
                  {status}: {count}
                </span>
              ))}
              <span className="ml-auto text-base-content/60">
                Spend today:{" "}
                {Object.entries(overview.spendUsdByProvider)
                  .map(([provider, usd]) => `${provider} $${usd.toFixed(2)}`)
                  .join(" · ") || "$0"}
              </span>
            </div>

            {overview.latestDaily ? (
              <details className="collapse-arrow collapse rounded-lg border border-base-300">
                <summary className="collapse-title font-medium">
                  {overview.latestDaily.title}
                </summary>
                <div className="collapse-content">
                  <Markdown className="text-sm">
                    {overview.latestDaily.content}
                  </Markdown>
                </div>
              </details>
            ) : (
              <p className="text-sm text-base-content/60">
                No report yet — add seeds via the MCP tool
                <code className="mx-1">add_opportunities</code>and run a scan.
              </p>
            )}

            <div className="overflow-x-auto rounded-lg border border-base-300">
              <table className="table table-sm">
                <thead>
                  <tr className="text-xs text-base-content/60">
                    <th>Opportunity</th>
                    <th>中文名</th>
                    <th>Type</th>
                    <th>
                      <SortableHeader
                        label="Status"
                        isActive={sort?.key === "status"}
                        order={sort?.key === "status" ? sort.order : "asc"}
                        onClick={() => toggleSort("status")}
                      />
                    </th>
                    <th className="text-right">
                      <SortableHeader
                        label="Score"
                        isActive={sort?.key === "score"}
                        order={sort?.key === "score" ? sort.order : "desc"}
                        onClick={() => toggleSort("score")}
                      />
                    </th>
                    <th className="text-right">Confidence</th>
                    <th>IP</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunities.map((opportunity) => {
                    const isExpanded = selectedId === opportunity.id;
                    return (
                      <React.Fragment key={opportunity.id}>
                        <tr
                          className={`cursor-pointer hover:bg-base-200 ${isExpanded ? "bg-base-200" : ""}`}
                          onClick={() =>
                            setSelectedId(isExpanded ? null : opportunity.id)
                          }
                        >
                          <td className="font-medium">
                            <span className="flex items-center gap-1.5">
                              <ChevronRight
                                className={`size-3.5 shrink-0 text-base-content/40 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              />
                              {opportunity.name}
                            </span>
                          </td>
                          <td className="text-base-content/70">
                            {opportunity.nameZh ?? "—"}
                          </td>
                          <td className="text-base-content/70">
                            {TYPE_LABELS[opportunity.type] ?? opportunity.type}
                          </td>
                          <td>
                            <span
                              className={`badge badge-sm ${STATUS_BADGE[opportunity.status] ?? "badge-ghost"}`}
                            >
                              {opportunity.status}
                            </span>
                          </td>
                          <td className="text-right font-semibold tabular-nums">
                            {opportunity.latestScore ?? "—"}
                          </td>
                          <td className="text-right tabular-nums text-base-content/70">
                            {opportunity.latestConfidence ?? "—"}
                          </td>
                          <td>
                            <span
                              className={`badge badge-sm ${opportunity.ipRisk === "green" ? "badge-ghost" : opportunity.ipRisk === "red" ? "badge-error" : "badge-warning"}`}
                            >
                              {opportunity.ipRisk}
                            </span>
                          </td>
                          <td className="text-base-content/60">
                            {opportunity.statusChangedAt?.slice(0, 10) ?? ""}
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="hover:bg-transparent">
                            <td colSpan={8} className="bg-base-200/40 p-4">
                              <OpportunityDetail
                                opportunityId={opportunity.id}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                  {opportunities.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="text-center text-base-content/60"
                      >
                        No opportunities yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
