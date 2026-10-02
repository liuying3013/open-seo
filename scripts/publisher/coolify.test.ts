import { afterEach, describe, expect, it, vi } from "vitest";
import { CoolifyClient } from "./coolify";

const queuedForHead = {
  deployment_uuid: "queued-1",
  status: "queued",
  commit: "HEAD",
};

// Answers by path; unknown paths are 404s, like a dropped duplicate trigger.
function stubCoolify(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname.replace("/api/v1", "");
      return path in routes
        ? new Response(JSON.stringify(routes[path]))
        : new Response('{"message":"Deployment not found."}', { status: 404 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = new CoolifyClient("http://coolify.test", "token");

describe("CoolifyClient", () => {
  it("follows the queued deployment when Coolify drops a duplicate trigger", async () => {
    stubCoolify({
      "/deploy": { deployments: [{ deployment_uuid: "dropped" }] },
      "/deployments/applications/app": [queuedForHead],
    });
    expect(await client.triggerDeploy("app")).toBe("queued-1");
  });

  it("takes a queued deployment that has not resolved its commit as the push's", async () => {
    stubCoolify({ "/deployments/applications/app": [queuedForHead] });
    expect(await client.findOrTriggerDeployment("app", "abc1234")).toBe(
      "queued-1",
    );
  });
});
