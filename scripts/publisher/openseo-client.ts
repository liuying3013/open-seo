// Minimal OpenSEO MCP client over HTTP (stateless: initialize, then tools/call).

import { z } from "zod";

const siteSchema = z.object({
  githubRepo: z.string().nullable().optional(),
  productionBranch: z.string().nullable().optional(),
  autoDeploy: z.boolean().nullable().optional(),
  coolifyAppUuid: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
});

const listSitesSchema = z.object({
  sites: z.array(
    z.object({
      projectId: z.string(),
      name: z.string().optional(),
      domain: z.string().nullable().optional(),
      registry: siteSchema.nullable().optional(),
    }),
  ),
});

export const draftSchema = z.object({
  title: z.string(),
  body: z.string(),
});

const publishItemSchema = z.object({
  assetId: z.string(),
  approvalId: z.string(),
  versionId: z.string(),
  version: z.number(),
  approvedPatchId: z.string(),
  targetUrl: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  taskBranch: z.string(),
  headCommit: z.string().nullable().optional(),
  draft: draftSchema,
  activeAttempt: z
    .object({ id: z.string(), status: z.string() })
    .nullable()
    .optional(),
  failedAttempts: z.number().default(0),
});

const rollbackItemSchema = z.object({
  attemptId: z.string(),
  assetId: z.string(),
  targetUrl: z.string().nullable().optional(),
  mergeCommit: z.string().nullable().optional(),
});

const queueSchema = z.object({
  publish: z.array(publishItemSchema),
  rollbacks: z.array(rollbackItemSchema),
});

export type SiteEntry = z.infer<typeof listSitesSchema>["sites"][number];
export type PublishItem = z.infer<typeof publishItemSchema>;
export type RollbackItem = z.infer<typeof rollbackItemSchema>;
export type PublishQueue = z.infer<typeof queueSchema>;

export type RecordAttemptArgs = {
  projectId: string;
  attemptId?: string;
  assetId?: string;
  approvalId?: string;
  status:
    | "publishing"
    | "deploying"
    | "verifying"
    | "published"
    | "failed"
    | "rolled_back"
    | "unverified";
  mergeCommit?: string;
  coolifyDeploymentUuid?: string;
  liveStatusCode?: number;
  textMatch?: number;
  liveCheck?: { noindex: boolean; canonical?: string | null; notes?: string };
  publishedUrl?: string;
  errorStage?: "fingerprint" | "merge" | "push" | "deploy" | "verify";
  errorMessage?: string;
  screenshotDesktopPngBase64?: string;
  screenshotMobilePngBase64?: string;
};

const attemptResultSchema = z.object({
  attemptId: z.string(),
  status: z.string(),
  reason: z.string().nullable().optional(),
});

/** Response bodies are JSON or an SSE stream; return the JSON-RPC message. */
export function parseRpcBody(body: string, contentType: string): unknown {
  if (!contentType.includes("text/event-stream")) return JSON.parse(body);
  const messages = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  const last = messages.at(-1);
  if (!last) throw new Error("Empty event stream from MCP endpoint.");
  return JSON.parse(last);
}

export class OpenSeoClient {
  private nextId = 1;
  private initialized = false;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async rpc(method: string, params: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": "openseo-publisher/1.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId++,
        method,
        params,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `MCP ${method}: HTTP ${response.status} ${text.slice(0, 300)}`,
      );
    }
    const message = parseRpcBody(
      text,
      response.headers.get("content-type") ?? "",
    ) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (message.error) {
      throw new Error(`MCP ${method}: ${message.error.message ?? "error"}`);
    }
    return message.result;
  }

  private async callTool(name: string, args: unknown): Promise<unknown> {
    if (!this.initialized) {
      await this.rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "openseo-publisher", version: "1.0.0" },
      });
      this.initialized = true;
    }
    const result = (await this.rpc("tools/call", {
      name,
      arguments: args,
    })) as {
      isError?: boolean;
      structuredContent?: unknown;
      content?: Array<{ type: string; text?: string }>;
    };
    const text = result.content?.find((part) => part.type === "text")?.text;
    if (result.isError)
      throw new Error(`Tool ${name} failed: ${text ?? "unknown error"}`);
    if (result.structuredContent !== undefined) return result.structuredContent;
    if (text) return JSON.parse(text);
    throw new Error(`Tool ${name} returned no content.`);
  }

  async listSites(): Promise<SiteEntry[]> {
    return listSitesSchema.parse(await this.callTool("list_sites", {})).sites;
  }

  async listPublishQueue(projectId: string): Promise<PublishQueue> {
    return queueSchema.parse(
      await this.callTool("list_publish_queue", { projectId }),
    );
  }

  async recordAttempt(args: RecordAttemptArgs) {
    return attemptResultSchema.parse(
      await this.callTool("record_publish_attempt", args),
    );
  }

  async reportSiteChanges(
    projectId: string,
    commits: Array<{ sha: string; author: string; message: string }>,
  ) {
    await this.callTool("report_site_changes", { projectId, commits });
  }
}
