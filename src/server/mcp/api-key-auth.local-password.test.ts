import { McpServer } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyApiKey: vi.fn(),
  getHostedUser: vi.fn(),
  getMembership: vi.fn(),
  resolveExistingActiveHostedOrganization: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { verifyApiKey: mocks.verifyApiKey } }),
  getHostedBaseUrl: () => "https://open-seo.test",
}));

vi.mock("@/server/auth/repositories/AuthRepository", () => ({
  AuthRepository: {
    getHostedUser: mocks.getHostedUser,
    getMembership: mocks.getMembership,
  },
}));

vi.mock("@/server/auth/default-hosted-organization", () => ({
  resolveExistingActiveHostedOrganization:
    mocks.resolveExistingActiveHostedOrganization,
}));

vi.mock("@/server/features/activation/mcpActivation", () => ({
  recordMcpAuthorized: vi.fn(),
}));

// Self-hosted identity resolvers are unused here but pull in cloudflare:workers.
vi.mock("@/middleware/ensure-user/cloudflareAccess", () => ({}));
vi.mock("@/middleware/ensure-user/delegated", () => ({}));

// Real transport and MCP protocol handling; only the tool registry is stubbed.
vi.mock("@/server/mcp/server", () => ({
  createOpenSeoMcpServer: () =>
    new McpServer({ name: "OpenSEO MCP", version: "0.0.0" }),
}));

import { handleLocalPasswordMcpRequest } from "@/server/mcp/api-key-auth";

const ctx: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
};

function initializeRequest(headers?: Record<string, string>) {
  return new Request("https://open-seo.test/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    }),
  });
}

describe("handleLocalPasswordMcpRequest", () => {
  beforeEach(() => {
    mocks.getHostedUser.mockResolvedValue({
      id: "user-1",
      email: "admin@example.com",
    });
    mocks.getMembership.mockResolvedValue({ role: "owner" });
    mocks.resolveExistingActiveHostedOrganization.mockResolvedValue({
      organizationId: "delegated-local-admin",
      role: "owner",
    });
  });

  it("rejects a request without a key with a 401 challenge", async () => {
    const response = await handleLocalPasswordMcpRequest(
      initializeRequest(),
      {},
      ctx,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(mocks.verifyApiKey).not.toHaveBeenCalled();
  });

  it("rejects an invalid key with a 401 challenge", async () => {
    mocks.verifyApiKey.mockResolvedValue({
      valid: false,
      error: { code: "INVALID_API_KEY" },
      key: null,
    });

    const response = await handleLocalPasswordMcpRequest(
      initializeRequest({ "x-api-key": "oseo_revoked" }),
      {},
      ctx,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it.each([
    ["Authorization", "Bearer oseo_valid"],
    ["x-api-key", "oseo_valid"],
  ])(
    "initializes an MCP session with a valid key in %s",
    async (name, value) => {
      mocks.verifyApiKey.mockResolvedValue({
        valid: true,
        error: null,
        key: { referenceId: "user-1" },
      });

      const response = await handleLocalPasswordMcpRequest(
        initializeRequest({ [name]: value }),
        {},
        ctx,
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"serverInfo"');
      expect(mocks.verifyApiKey).toHaveBeenCalledWith({
        body: { key: "oseo_valid" },
      });
    },
  );
});
