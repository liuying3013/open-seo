import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { SiteRegistryRepository } from "@/server/features/site-registry/repositories/SiteRegistryRepository";
import { PlausibleService } from "./PlausibleService";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock(
  "@/server/features/site-registry/repositories/SiteRegistryRepository",
  () => ({ SiteRegistryRepository: { getPlausibleSite: vi.fn() } }),
);

const mapSite = (plausibleSite: string | null) =>
  vi
    .mocked(SiteRegistryRepository.getPlausibleSite)
    .mockResolvedValue(plausibleSite);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PlausibleService.getStats", () => {
  it("returns not_connected when the project has no Plausible site", async () => {
    mapSite(null);
    vi.stubEnv("PLAUSIBLE_BASE_URL", "https://plausible.test");
    vi.stubEnv("PLAUSIBLE_API_KEY", "key");

    expect(await PlausibleService.getStats({ projectId: "p1" })).toEqual({
      status: "not_connected",
      reason: "site_not_configured",
      plausibleSite: null,
    });
  });

  it("returns not_connected when the API key is missing, without calling Plausible", async () => {
    mapSite("example.com");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("PLAUSIBLE_BASE_URL", "");
    vi.stubEnv("PLAUSIBLE_API_KEY", "");

    expect(await PlausibleService.getStats({ projectId: "p1" })).toEqual({
      status: "not_connected",
      reason: "api_key_missing",
      plausibleSite: "example.com",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns totals and a page breakdown when connected", async () => {
    mapSite("example.com");
    vi.stubEnv("PLAUSIBLE_BASE_URL", "https://plausible.test/");
    vi.stubEnv("PLAUSIBLE_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_url, init) => {
        const body = z
          .record(z.string(), z.unknown())
          .parse(
            JSON.parse(typeof init?.body === "string" ? init.body : "null"),
          );
        return Response.json({
          results: body.dimensions
            ? [{ metrics: [8, 20], dimensions: ["/a"] }]
            : [{ metrics: [10, 12, 30, 40, 55], dimensions: [] }],
        });
      }),
    );

    expect(
      await PlausibleService.getStats({
        projectId: "p1",
        dimension: "page",
      }),
    ).toEqual({
      status: "ok",
      plausibleSite: "example.com",
      dateRange: "30d",
      totals: {
        visitors: 10,
        visits: 12,
        pageviews: 30,
        bounceRate: 40,
        visitDurationSeconds: 55,
      },
      dimension: "page",
      rows: [{ key: "/a", visitors: 8, pageviews: 20, visits: null }],
    });
  });

  it("reports an invalid key as an error status, not an exception", async () => {
    mapSite("example.com");
    vi.stubEnv("PLAUSIBLE_BASE_URL", "https://plausible.test");
    vi.stubEnv("PLAUSIBLE_API_KEY", "bad");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "Invalid API key" }, { status: 401 }),
      ),
    );

    expect(await PlausibleService.getStats({ projectId: "p1" })).toMatchObject({
      status: "error",
      kind: "unauthorized",
    });
  });
});

describe("PlausibleService.listRemoteSites", () => {
  it("maps a server without Sites API access to unsupported", async () => {
    vi.stubEnv("PLAUSIBLE_BASE_URL", "https://plausible.test");
    vi.stubEnv("PLAUSIBLE_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not Found", { status: 404 })),
    );

    expect(await PlausibleService.listRemoteSites()).toMatchObject({
      status: "unsupported",
    });
  });
});
