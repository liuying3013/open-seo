import { getOptionalEnvValue } from "@/server/lib/runtime-env";

// Plausible Stats API v2 + the optional Sites API v1. Self-hosted Community
// Edition does not always expose the Sites API, and an API key may be limited,
// so every call returns a result union instead of throwing: callers decide how
// to present "unsupported or not permitted".

const REQUEST_TIMEOUT_MS = 15_000;

export type PlausibleConfig = { baseUrl: string; apiKey: string };

export type PlausibleErrorKind =
  // 401 / 403: the key is wrong, or not allowed to use this endpoint.
  | "unauthorized"
  // 404: the site is unknown, or the endpoint does not exist on this server.
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network"
  | "malformed_response";

type PlausibleResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: PlausibleErrorKind; message: string };

type PlausibleQuery = {
  siteId: string;
  metrics: string[];
  /** A preset such as "30d" / "month" / "all", or [startDate, endDate]. */
  dateRange: string | [string, string];
  dimensions?: string[];
  /** Plausible filter triples, e.g. ["is", "event:page", ["/pricing"]]. */
  filters?: unknown[];
  orderBy?: [string, "asc" | "desc"][];
  limit?: number;
};

export type PlausibleQueryRow = {
  metrics: (number | null)[];
  dimensions: string[];
};

export type PlausibleGoal = {
  id: string | number | null;
  displayName: string;
  goalType: string | null;
  eventName: string | null;
  pagePath: string | null;
};

export async function getPlausibleConfig(): Promise<PlausibleConfig | null> {
  const baseUrl = (await getOptionalEnvValue("PLAUSIBLE_BASE_URL"))?.trim();
  const apiKey = (await getOptionalEnvValue("PLAUSIBLE_API_KEY"))?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function classifyStatus(status: number): PlausibleErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "bad_request";
}

async function readErrorMessage(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "string"
    ) {
      return parsed.error;
    }
  } catch {
    // Not JSON (for example an HTML 404 page): fall through to the status line.
  }
  return `${response.status} ${response.statusText}`.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const text = (value: unknown) => (typeof value === "string" ? value : null);

const malformed = (what: string): PlausibleResult<never> => ({
  ok: false,
  kind: "malformed_response",
  message: `Plausible returned an unexpected ${what} response.`,
});

export function createPlausibleClient(
  config: PlausibleConfig,
  fetchImpl: typeof fetch = fetch,
) {
  async function request(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown },
  ): Promise<PlausibleResult<unknown>> {
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...(init.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return {
        ok: false,
        kind: timedOut ? "timeout" : "network",
        message: timedOut
          ? "Plausible did not respond in time."
          : "Could not reach the Plausible server.",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        kind: classifyStatus(response.status),
        message: await readErrorMessage(response),
      };
    }
    try {
      return { ok: true, data: await response.json() };
    } catch {
      return {
        ok: false,
        kind: "malformed_response",
        message: "Plausible returned a response that is not JSON.",
      };
    }
  }

  return {
    /** Stats API v2: POST /api/v2/query. */
    async query(
      query: PlausibleQuery,
    ): Promise<PlausibleResult<PlausibleQueryRow[]>> {
      const result = await request("/api/v2/query", {
        method: "POST",
        body: {
          site_id: query.siteId,
          metrics: query.metrics,
          date_range: query.dateRange,
          ...(query.dimensions ? { dimensions: query.dimensions } : {}),
          ...(query.filters ? { filters: query.filters } : {}),
          ...(query.orderBy ? { order_by: query.orderBy } : {}),
          ...(query.limit ? { pagination: { limit: query.limit } } : {}),
        },
      });
      if (!result.ok) return result;
      const results = isRecord(result.data) ? result.data.results : null;
      if (!Array.isArray(results)) return malformed("query");
      const rows: PlausibleQueryRow[] = [];
      for (const row of results) {
        if (
          !isRecord(row) ||
          !Array.isArray(row.metrics) ||
          !Array.isArray(row.dimensions)
        ) {
          return malformed("query");
        }
        rows.push({
          metrics: row.metrics.map((value) =>
            typeof value === "number" ? value : null,
          ),
          dimensions: row.dimensions.map(String),
        });
      }
      return { ok: true, data: rows };
    },

    /** Sites API v1: GET /api/v1/sites. Not available on every server. */
    async listSites(): Promise<PlausibleResult<string[]>> {
      const result = await request("/api/v1/sites", { method: "GET" });
      if (!result.ok) return result;
      const sites = isRecord(result.data) ? result.data.sites : null;
      if (!Array.isArray(sites)) return malformed("sites");
      return {
        ok: true,
        data: sites.flatMap((site) =>
          isRecord(site) && typeof site.domain === "string"
            ? [site.domain]
            : [],
        ),
      };
    },

    /** Sites API v1: GET /api/v1/sites/goals?site_id=. */
    async listGoals(siteId: string): Promise<PlausibleResult<PlausibleGoal[]>> {
      const result = await request(
        `/api/v1/sites/goals?site_id=${encodeURIComponent(siteId)}`,
        { method: "GET" },
      );
      if (!result.ok) return result;
      const goals = isRecord(result.data) ? result.data.goals : null;
      if (!Array.isArray(goals)) return malformed("goals");
      return {
        ok: true,
        data: goals.flatMap((goal) =>
          isRecord(goal)
            ? [
                {
                  id:
                    typeof goal.id === "string" || typeof goal.id === "number"
                      ? goal.id
                      : null,
                  displayName: text(goal.display_name) ?? "",
                  goalType: text(goal.goal_type),
                  eventName: text(goal.event_name),
                  pagePath: text(goal.page_path),
                },
              ]
            : [],
        ),
      };
    },
  };
}
