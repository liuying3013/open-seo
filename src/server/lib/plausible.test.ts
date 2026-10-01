import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createPlausibleClient } from "./plausible";

const config = { baseUrl: "https://plausible.test", apiKey: "secret" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const urlOf = (input: RequestInfo | URL) =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

const bodyOf = (init?: RequestInit) =>
  z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(typeof init?.body === "string" ? init.body : "null"));

describe("createPlausibleClient", () => {
  it("posts a Stats API v2 query with bearer auth and parses the rows", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ results: [{ metrics: [12, null], dimensions: ["/pricing"] }] }),
    );
    const client = createPlausibleClient(config, fetchMock);

    const result = await client.query({
      siteId: "example.com",
      metrics: ["visitors", "bounce_rate"],
      dateRange: ["2026-01-01", "2026-01-31"],
      dimensions: ["event:page"],
      orderBy: [["visitors", "desc"]],
      limit: 5,
    });

    expect(result).toEqual({
      ok: true,
      data: [{ metrics: [12, null], dimensions: ["/pricing"] }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(urlOf(url)).toBe("https://plausible.test/api/v2/query");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(bodyOf(init)).toEqual({
      site_id: "example.com",
      metrics: ["visitors", "bounce_rate"],
      date_range: ["2026-01-01", "2026-01-31"],
      dimensions: ["event:page"],
      order_by: [["visitors", "desc"]],
      pagination: { limit: 5 },
    });
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "not_found"],
    [400, "bad_request"],
    [429, "rate_limited"],
    [502, "server_error"],
  ])("classifies HTTP %i as %s without throwing", async (status, kind) => {
    const client = createPlausibleClient(config, async () =>
      json({ error: "nope" }, status),
    );
    expect(await client.listSites()).toEqual({
      ok: false,
      kind,
      message: "nope",
    });
  });

  it("reports network failures and timeouts as results", async () => {
    const down = createPlausibleClient(config, async () => {
      throw new TypeError("fetch failed");
    });
    const slow = createPlausibleClient(config, async () => {
      throw new DOMException("timed out", "TimeoutError");
    });

    expect(await down.listSites()).toMatchObject({ kind: "network" });
    expect(await slow.listSites()).toMatchObject({ kind: "timeout" });
  });

  it("lists sites and goals from the Sites API", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      urlOf(url).includes("/goals")
        ? json({
            goals: [
              {
                id: 7,
                display_name: "Signup",
                goal_type: "event",
                event_name: "signup",
              },
            ],
          })
        : json({ sites: [{ domain: "example.com" }] }),
    );
    const client = createPlausibleClient(config, fetchMock);

    expect(await client.listSites()).toEqual({
      ok: true,
      data: ["example.com"],
    });
    expect(await client.listGoals("example.com")).toEqual({
      ok: true,
      data: [
        {
          id: 7,
          displayName: "Signup",
          goalType: "event",
          eventName: "signup",
          pagePath: null,
        },
      ],
    });
    expect(urlOf(fetchMock.mock.calls[1][0])).toBe(
      "https://plausible.test/api/v1/sites/goals?site_id=example.com",
    );
  });
});
