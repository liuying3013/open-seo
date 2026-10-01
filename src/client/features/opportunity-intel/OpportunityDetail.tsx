import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Markdown } from "@/client/components/Markdown";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { AreaTrendChart } from "@/client/features/keywords/components/DisplayPrimitives";
import type { MonthlySearch } from "@/types/keywords";
import {
  getOpportunityIntelDetail,
  reviewOpportunityIntel,
} from "@/serverFunctions/opportunity-intel";
import { getProjects } from "@/serverFunctions/projects";
import {
  STATUS_BADGE,
  TYPE_LABELS,
} from "@/client/features/opportunity-intel/labels";
import {
  KeywordsCard,
  SerpEvidenceCard,
  dedupeKeywords,
} from "@/client/features/opportunity-intel/OpportunityDetailCards";
import type { DetailData } from "@/client/features/opportunity-intel/detailData";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Aggregate 12-month trend across the deduped keyword set. */
function aggregateTrend(rows: DetailData["keywords"]): MonthlySearch[] {
  const byMonth = new Map<number, MonthlySearch>();
  for (const row of rows) {
    if (!row.trend) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.trend);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const item of parsed) {
      if (!isRecord(item)) continue;
      const { year, month, searchVolume } = item;
      if (
        typeof year !== "number" ||
        typeof month !== "number" ||
        typeof searchVolume !== "number"
      ) {
        continue;
      }
      const key = year * 100 + month;
      const existing = byMonth.get(key);
      if (existing) existing.searchVolume += searchVolume;
      else byMonth.set(key, { year, month, searchVolume });
    }
  }
  return [...byMonth.values()];
}

const DIMENSION_META: Array<[string, string]> = [
  ["commercialSearchDemand", "Commercial demand"],
  ["serpSupplyGap", "Supply gap"],
  ["competitorWeakness", "Competitor weakness"],
  ["seoScalability", "SEO scalability"],
  ["ipLegalRisk", "IP safety"],
];

function parseDimensions(
  scores: DetailData["scores"],
): Array<{ label: string; value: number }> {
  const latest =
    scores.find((row) => row.stage === "serp") ?? scores[0] ?? null;
  if (!latest) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(latest.breakdown);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !isRecord(parsed.dimensions)) return [];
  const dimensions = parsed.dimensions;
  return DIMENSION_META.flatMap(([key, label]) => {
    const value = dimensions[key];
    return typeof value === "number"
      ? [{ label, value: Math.round(value) }]
      : [];
  });
}

export function OpportunityDetail({
  opportunityId,
}: {
  opportunityId: string;
}) {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = React.useState("");
  const detailQuery = useQuery({
    queryKey: ["opportunity-intel", "detail", opportunityId],
    queryFn: () => getOpportunityIntelDetail({ data: { opportunityId } }),
  });
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(),
  });
  const reviewMutation = useMutation({
    mutationFn: (input: {
      action: "graduate" | "reject" | "watchlist" | "resume" | "sync_keywords";
    }) =>
      reviewOpportunityIntel({
        data: {
          opportunityId,
          action: input.action,
          projectId: ["graduate", "sync_keywords"].includes(input.action)
            ? projectId
            : undefined,
        },
      }),
    onSuccess: (result, input) => {
      toast.success(
        input.action === "sync_keywords"
          ? `Saved ${result.promotedKeywords ?? 0} keywords into the project pool.`
          : `Opportunity is now ${result.status}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["opportunity-intel"] });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const detail = detailQuery.data;
  if (detailQuery.isLoading) {
    return (
      <div className="flex justify-center py-6">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }
  if (!detail) return null;
  const { opportunity, keywords, snapshots, log, detailReport } = detail;
  const deduped = dedupeKeywords(keywords);
  const trend = aggregateTrend(deduped);
  const dimensions = parseDimensions(detail.scores);

  return (
    <div className="space-y-4">
      {/* Header card: identity + review actions + stats */}
      <div className="rounded-lg border border-base-300 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{opportunity.name}</h2>
              <span
                className={`badge badge-sm ${STATUS_BADGE[opportunity.status] ?? "badge-ghost"}`}
              >
                {opportunity.status}
              </span>
              <span className="badge badge-ghost badge-sm">
                {TYPE_LABELS[opportunity.type] ?? opportunity.type}
              </span>
              <span
                className={`badge badge-sm ${opportunity.ipRisk === "green" ? "badge-ghost" : "badge-warning"}`}
              >
                IP {opportunity.ipRisk}
              </span>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-base-content/70">
              {opportunity.description ?? "No description yet."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {opportunity.status !== "graduated" ? (
              <>
                <select
                  className="select select-sm select-bordered"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  <option value="">Target project…</option>
                  {(projectsQuery.data ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                {/* "Save the words without graduating": reuse the paid metrics
                    in Keyword Research / Saved Keywords, funnel state untouched. */}
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!projectId || reviewMutation.isPending}
                  onClick={() =>
                    reviewMutation.mutate({ action: "sync_keywords" })
                  }
                >
                  Save keywords
                </button>
              </>
            ) : null}
            {opportunity.status === "shortlisted" ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!projectId || reviewMutation.isPending}
                onClick={() => reviewMutation.mutate({ action: "graduate" })}
              >
                Graduate
              </button>
            ) : null}
            {["watchlist", "paused", "rejected"].includes(
              opportunity.status,
            ) ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={reviewMutation.isPending}
                onClick={() =>
                  reviewMutation.mutate({
                    action:
                      opportunity.status === "rejected"
                        ? "watchlist"
                        : "resume",
                  })
                }
              >
                {opportunity.status === "rejected" ? "To watchlist" : "Resume"}
              </button>
            ) : null}
            {!["rejected", "graduated"].includes(opportunity.status) ? (
              <button
                type="button"
                className="btn btn-outline btn-error btn-sm"
                disabled={reviewMutation.isPending}
                onClick={() => reviewMutation.mutate({ action: "reject" })}
              >
                Reject
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-6 md:grid-cols-[auto_auto_1fr]">
          <div>
            <div className="text-xs uppercase tracking-wide text-base-content/50">
              Score
            </div>
            <div className="text-3xl font-bold tabular-nums">
              {opportunity.latestScore ?? "—"}
            </div>
            <div className="text-xs text-base-content/50">
              {opportunity.latestScoreVersion ?? ""}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-base-content/50">
              Confidence
            </div>
            <div className="text-3xl font-bold tabular-nums">
              {opportunity.latestConfidence ?? "—"}
            </div>
            <div className="text-xs text-base-content/50">
              evidence coverage
            </div>
          </div>
          {dimensions.length > 0 ? (
            <div className="max-w-md space-y-1.5">
              {dimensions.map((dimension) => (
                <div key={dimension.label}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-base-content/60">
                      {dimension.label}
                    </span>
                    <span className="font-medium tabular-nums">
                      {dimension.value}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-base-200">
                    <div
                      className="h-1.5 rounded-full bg-primary"
                      style={{ width: `${Math.min(100, dimension.value)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Search trend across the keyword set */}
      {trend.length > 0 ? (
        <div className="rounded-lg border border-base-300 p-4">
          <h3 className="mb-2 text-sm font-semibold">
            Search trend
            <span className="ml-2 font-normal text-base-content/50">
              summed monthly volume across {deduped.length} keywords
            </span>
          </h3>
          <AreaTrendChart trend={trend} />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <KeywordsCard keywords={keywords} />
        <SerpEvidenceCard snapshots={snapshots} />
      </div>

      {detailReport ? (
        <details className="collapse-arrow collapse rounded-lg border border-base-300">
          <summary className="collapse-title text-sm font-medium">
            {detailReport.title}
          </summary>
          <div className="collapse-content">
            <Markdown className="text-sm">{detailReport.content}</Markdown>
          </div>
        </details>
      ) : null}

      <details className="collapse-arrow collapse rounded-lg border border-base-300">
        <summary className="collapse-title text-sm font-medium">
          Decision log ({log.length})
        </summary>
        <div className="collapse-content space-y-2 text-sm">
          {log.map((entry) => (
            <div key={entry.id}>
              <span className="font-mono text-xs text-base-content/60">
                {entry.createdAt.slice(0, 16)}
              </span>{" "}
              <span className="badge badge-ghost badge-sm">
                {entry.decisionType}
              </span>{" "}
              {entry.reasonSummary ?? ""}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
