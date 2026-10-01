import { SiteRegistryRepository } from "@/server/features/site-registry/repositories/SiteRegistryRepository";
import {
  createPlausibleClient,
  getPlausibleConfig,
  type PlausibleConfig,
  type PlausibleErrorKind,
  type PlausibleGoal,
  type PlausibleQueryRow,
} from "@/server/lib/plausible";
import type { PlausibleStatsInput } from "@/types/schemas/plausible";

// "Not connected" is a normal state (no key, or the site has no Plausible
// mapping), so it is a returned status, never an exception.
type NotConnected = {
  status: "not_connected";
  reason: "api_key_missing" | "site_not_configured";
  plausibleSite: string | null;
};
type Failed = {
  status: "error";
  kind: PlausibleErrorKind;
  message: string;
  plausibleSite: string;
};
// The Sites API is optional on self-hosted servers: 401 / 403 / 404 mean the
// server does not offer it to this key, not that something is broken.
type Unsupported = { status: "unsupported"; message: string };

const SUMMARY_METRICS = [
  "visitors",
  "visits",
  "pageviews",
  "bounce_rate",
  "visit_duration",
] as const;

const DIMENSIONS = {
  page: { name: "event:page", metrics: ["visitors", "pageviews"] },
  source: { name: "visit:source", metrics: ["visitors", "visits"] },
} as const;

const DEFAULT_BREAKDOWN_LIMIT = 50;

function toPlausibleDateRange(input: PlausibleStatsInput) {
  if (input.startDate && input.endDate) {
    return [input.startDate, input.endDate] satisfies [string, string];
  }
  return input.dateRange ?? "30d";
}

function metric(row: PlausibleQueryRow | undefined, index: number) {
  return row?.metrics[index] ?? null;
}

async function resolveSite(
  projectId: string,
): Promise<
  | { ok: true; plausibleSite: string; config: PlausibleConfig }
  | { ok: false; result: NotConnected }
> {
  const plausibleSite =
    (await SiteRegistryRepository.getPlausibleSite(projectId))?.trim() || null;
  if (!plausibleSite) {
    return {
      ok: false,
      result: {
        status: "not_connected",
        reason: "site_not_configured",
        plausibleSite: null,
      },
    };
  }
  const config = await getPlausibleConfig();
  if (!config) {
    return {
      ok: false,
      result: {
        status: "not_connected",
        reason: "api_key_missing",
        plausibleSite,
      },
    };
  }
  return { ok: true, plausibleSite, config };
}

async function getStats(input: PlausibleStatsInput) {
  const resolved = await resolveSite(input.projectId);
  if (!resolved.ok) return resolved.result;
  const { plausibleSite, config } = resolved;
  const client = createPlausibleClient(config);
  const dateRange = toPlausibleDateRange(input);
  const fail = (error: {
    kind: PlausibleErrorKind;
    message: string;
  }): Failed => ({
    status: "error",
    kind: error.kind,
    message: error.message,
    plausibleSite,
  });

  const summary = await client.query({
    siteId: plausibleSite,
    metrics: [...SUMMARY_METRICS],
    dateRange,
  });
  if (!summary.ok) return fail(summary);
  const totalsRow = summary.data[0];
  const totals = {
    visitors: metric(totalsRow, 0),
    visits: metric(totalsRow, 1),
    pageviews: metric(totalsRow, 2),
    bounceRate: metric(totalsRow, 3),
    visitDurationSeconds: metric(totalsRow, 4),
  };

  if (!input.dimension) {
    return { status: "ok" as const, plausibleSite, dateRange, totals };
  }
  const dimension = DIMENSIONS[input.dimension];
  const breakdown = await client.query({
    siteId: plausibleSite,
    metrics: [...dimension.metrics],
    dimensions: [dimension.name],
    dateRange,
    orderBy: [["visitors", "desc"]],
    limit: input.limit ?? DEFAULT_BREAKDOWN_LIMIT,
  });
  if (!breakdown.ok) return fail(breakdown);
  return {
    status: "ok" as const,
    plausibleSite,
    dateRange,
    totals,
    dimension: input.dimension,
    rows: breakdown.data.map((row) => ({
      key: row.dimensions[0] ?? "",
      visitors: row.metrics[0] ?? null,
      // The second metric is pageviews for pages and visits for sources.
      pageviews: input.dimension === "page" ? (row.metrics[1] ?? null) : null,
      visits: input.dimension === "source" ? (row.metrics[1] ?? null) : null,
    })),
  };
}

function unsupportedOrFailed(
  error: { kind: PlausibleErrorKind; message: string },
  plausibleSite: string | null,
): Unsupported | Failed {
  if (error.kind === "unauthorized" || error.kind === "not_found") {
    return {
      status: "unsupported",
      message:
        "This Plausible server does not offer the Sites API to this API key (unsupported, or the key has no permission).",
    };
  }
  return {
    status: "error",
    kind: error.kind,
    message: error.message,
    plausibleSite: plausibleSite ?? "",
  };
}

/** Sites known to Plausible, to check registry `plausible_site` values. */
async function listRemoteSites() {
  const config = await getPlausibleConfig();
  if (!config) {
    return {
      status: "not_connected" as const,
      reason: "api_key_missing" as const,
      plausibleSite: null,
    };
  }
  const result = await createPlausibleClient(config).listSites();
  if (!result.ok) return unsupportedOrFailed(result, null);
  return { status: "ok" as const, sites: result.data };
}

/** Goals configured for a project's Plausible site. */
async function listGoals(projectId: string) {
  const resolved = await resolveSite(projectId);
  if (!resolved.ok) return resolved.result;
  const result = await createPlausibleClient(resolved.config).listGoals(
    resolved.plausibleSite,
  );
  if (!result.ok) return unsupportedOrFailed(result, resolved.plausibleSite);
  return {
    status: "ok" as const,
    plausibleSite: resolved.plausibleSite,
    goals: result.data satisfies PlausibleGoal[],
  };
}

export const PlausibleService = { getStats, listRemoteSites, listGoals };
