import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { AUTH_MODE: "local_password" },
  getSession: vi.fn(),
  setActiveOrganization: vi.fn(),
  getMembership: vi.fn(),
  findNewestMembershipForUser: vi.fn(),
  createOrganization: vi.fn(),
  resolveActiveHostedOrganization: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", () => ({
  hasPasswordAuthConfig: () => true,
  getAuth: () => ({ api: mocks }),
}));
vi.mock("@/server/auth/repositories/AuthRepository", () => ({
  AuthRepository: mocks,
}));
vi.mock("@/server/auth/default-hosted-organization", () => ({
  resolveActiveHostedOrganization: mocks.resolveActiveHostedOrganization,
}));

import { resolveHostedContext } from "./hosted";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.AUTH_MODE = "local_password";
  mocks.getSession.mockResolvedValue({
    user: {
      id: "existing-admin",
      email: "admin@example.com",
      emailVerified: true,
    },
    session: { activeOrganizationId: "existing-workspace" },
  });
});

describe("local password authorization", () => {
  it("rejects requests without a password-authenticated session", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(resolveHostedContext(new Headers())).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(mocks.getMembership).not.toHaveBeenCalled();
  });

  it("retains the existing user's workspace and owner role", async () => {
    mocks.getMembership.mockResolvedValue({ role: "owner" });
    await expect(resolveHostedContext(new Headers())).resolves.toMatchObject({
      userId: "existing-admin",
      organizationId: "existing-workspace",
      role: "owner",
    });
    expect(mocks.createOrganization).not.toHaveBeenCalled();
  });

  it("rejects a stale session after workspace membership is removed", async () => {
    mocks.getMembership.mockResolvedValue(null);
    mocks.findNewestMembershipForUser.mockResolvedValue(null);
    await expect(resolveHostedContext(new Headers())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.resolveActiveHostedOrganization).not.toHaveBeenCalled();
    expect(mocks.createOrganization).not.toHaveBeenCalled();
  });

  it("repairs a stale active workspace using a live membership", async () => {
    const headers = new Headers();
    mocks.getMembership.mockResolvedValue(null);
    mocks.findNewestMembershipForUser.mockResolvedValue({
      organizationId: "allowed-workspace",
      role: "admin",
    });
    await expect(resolveHostedContext(headers)).resolves.toMatchObject({
      organizationId: "allowed-workspace",
      role: "admin",
    });
    expect(mocks.setActiveOrganization).toHaveBeenCalledWith({
      headers,
      body: { organizationId: "allowed-workspace" },
    });
  });
});
