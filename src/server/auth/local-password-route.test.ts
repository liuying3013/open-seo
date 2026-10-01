import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { AUTH_MODE: "local_password" },
  handler: vi.fn<(request: Request) => Promise<Response>>(),
  hasPasswordAuthConfig: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ handler: mocks.handler }),
  hasPasswordAuthConfig: mocks.hasPasswordAuthConfig,
}));
import { handleAuthRequest } from "@/routes/api/auth/$";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.AUTH_MODE = "local_password";
  mocks.hasPasswordAuthConfig.mockReturnValue(true);
  mocks.handler.mockResolvedValue(new Response("ok"));
});

describe("local password auth endpoints", () => {
  it.each([
    "sign-up/email",
    "request-password-reset",
    "sign-in/social",
    "organization/create",
    "update-user",
  ])("blocks %s", async (path) => {
    const response = await handleAuthRequest(
      new Request(`http://localhost/api/auth/${path}`, { method: "POST" }),
    );
    expect(response.status).toBe(404);
    expect(mocks.handler).not.toHaveBeenCalled();
  });
  it.each(["create", "list", "update", "delete"])(
    "allows api-key/%s",
    async (action) => {
      await handleAuthRequest(
        new Request(`http://localhost/api/auth/api-key/${action}`, {
          method: "POST",
        }),
      );
      expect(mocks.handler).toHaveBeenCalledTimes(1);
    },
  );
  it("uses a shared rate-limit bucket regardless of supplied IP headers", async () => {
    await handleAuthRequest(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: { "cf-connecting-ip": "198.51.100.1" },
      }),
    );
    const request = mocks.handler.mock.calls[0][0];
    expect(request.headers.get("cf-connecting-ip")).toBe("127.0.0.1");
  });
  it("fails closed if the session secret or URL is missing", async () => {
    mocks.hasPasswordAuthConfig.mockReturnValue(false);
    const response = await handleAuthRequest(
      new Request("http://localhost/api/auth/get-session"),
    );
    expect(response.status).toBe(500);
    expect(mocks.handler).not.toHaveBeenCalled();
  });
});
