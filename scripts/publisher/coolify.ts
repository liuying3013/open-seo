// Coolify API: trigger and follow deployments.

import { z } from "zod";

const POLL_INTERVAL_MS = 10_000;
const FIND_AUTO_DEPLOY_MS = 3 * 60_000;
export const DEPLOY_TIMEOUT_MS = 25 * 60_000;

const deploymentSchema = z.looseObject({
  deployment_uuid: z.string().optional(),
  uuid: z.string().optional(),
  status: z.string().optional(),
  commit: z.string().nullable().optional(),
});
type Deployment = z.infer<typeof deploymentSchema>;

const deployResponseSchema = z.looseObject({
  deployment_uuid: z.string().optional(),
  deployments: z.array(deploymentSchema).optional(),
});

// Older Coolify versions return a bare array, newer ones { deployments: [...] }.
const deploymentListSchema = z.union([
  z.array(deploymentSchema),
  z.looseObject({ deployments: z.array(deploymentSchema) }),
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const idOf = (deployment: Deployment) =>
  deployment.deployment_uuid ?? deployment.uuid;

// A queued deployment has not resolved its commit yet ("HEAD"); it builds the
// branch head once it starts, so it includes anything pushed before then.
const isQueuedForHead = (deployment: Deployment) =>
  deployment.status === "queued" &&
  (!deployment.commit || deployment.commit === "HEAD");

class CoolifyHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class CoolifyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request(
    method: string,
    pathAndQuery: string,
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/v1${pathAndQuery}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/json",
        "user-agent": "openseo-publisher/1.0",
      },
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new CoolifyHttpError(
        `Coolify ${method} ${pathAndQuery}: HTTP ${response.status} ${text.slice(0, 300)}`,
        response.status,
      );
    }
    return JSON.parse(text);
  }

  /** Trigger a deployment; returns its uuid. */
  async triggerDeploy(appUuid: string): Promise<string> {
    const body = deployResponseSchema.parse(
      await this.request(
        "POST",
        `/deploy?uuid=${encodeURIComponent(appUuid)}&force=false`,
      ),
    );
    const uuid = body.deployments?.[0] && idOf(body.deployments[0]);
    const found = uuid ?? body.deployment_uuid;
    if (!found) throw new Error("Coolify did not return a deployment uuid.");
    // While the app already has a deployment queued, Coolify drops the new
    // request but still answers with a uuid that never exists. Follow the
    // queued one instead.
    try {
      await this.getDeployment(found);
      return found;
    } catch (error) {
      if (!(error instanceof CoolifyHttpError) || error.status !== 404) {
        throw error;
      }
      const queued = (await this.listAppDeployments(appUuid)).find(
        isQueuedForHead,
      );
      const queuedUuid = queued && idOf(queued);
      if (!queuedUuid) throw error;
      return queuedUuid;
    }
  }

  async getDeployment(uuid: string): Promise<Deployment> {
    return deploymentSchema.parse(
      await this.request("GET", `/deployments/${encodeURIComponent(uuid)}`),
    );
  }

  async listAppDeployments(appUuid: string): Promise<Deployment[]> {
    const parsed = deploymentListSchema.parse(
      await this.request(
        "GET",
        `/deployments/applications/${encodeURIComponent(appUuid)}?skip=0&take=10`,
      ),
    );
    return Array.isArray(parsed) ? parsed : parsed.deployments;
  }

  /**
   * Find the deployment that is building `commit` (auto-deploy on push), and
   * trigger one ourselves when none shows up in time.
   */
  async findOrTriggerDeployment(
    appUuid: string,
    commit: string,
  ): Promise<string> {
    const deadline = Date.now() + FIND_AUTO_DEPLOY_MS;
    for (;;) {
      const list = await this.listAppDeployments(appUuid);
      const match = list.find(
        (item) =>
          isQueuedForHead(item) ||
          (item.commit &&
            (item.commit.startsWith(commit) || commit.startsWith(item.commit))),
      );
      const uuid = match && idOf(match);
      if (uuid) return uuid;
      if (Date.now() >= deadline) return this.triggerDeploy(appUuid);
      await sleep(POLL_INTERVAL_MS);
    }
  }

  /** Waits for a terminal status. Returns null on finished, else the reason. */
  async waitForDeployment(uuid: string): Promise<string | null> {
    const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
    for (;;) {
      const status = (await this.getDeployment(uuid)).status ?? "unknown";
      if (status === "finished") return null;
      if (status === "failed" || status.startsWith("cancelled")) {
        return `Deployment ${uuid} ended with status ${status}.`;
      }
      if (Date.now() >= deadline) {
        return `Deployment ${uuid} still ${status} after ${DEPLOY_TIMEOUT_MS / 60_000} minutes.`;
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }
}
