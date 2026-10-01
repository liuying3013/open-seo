import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { getAuth, hasPasswordAuthConfig } from "@/lib/auth";
import { getAuthMode, isPasswordAuthMode } from "@/lib/auth-mode";

const LOCAL_PASSWORD_ENDPOINTS = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/sign-out",
  "/api/auth/get-session",
  "/api/auth/list-sessions",
  "/api/auth/revoke-session",
  "/api/auth/revoke-sessions",
  "/api/auth/revoke-other-sessions",
  "/api/auth/change-password",
]);

export async function handleAuthRequest(request: Request) {
  if (!isPasswordAuthMode(env.AUTH_MODE)) {
    return new Response("Not found", {
      status: 404,
    });
  }

  const localPassword = getAuthMode(env.AUTH_MODE) === "local_password";
  if (
    localPassword &&
    !LOCAL_PASSWORD_ENDPOINTS.has(new URL(request.url).pathname)
  ) {
    return new Response("Not found", { status: 404 });
  }

  if (!hasPasswordAuthConfig()) {
    return new Response("Missing password authentication configuration", {
      status: 500,
    });
  }

  const auth = getAuth();
  if (localPassword) {
    // Private Docker installs lack a trusted client-IP header. Use one shared
    // login bucket and overwrite client-supplied headers to prevent bypasses.
    const headers = new Headers(request.headers);
    headers.set("cf-connecting-ip", "127.0.0.1");
    request = new Request(request, { headers });
  }
  return auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        return handleAuthRequest(request);
      },
      POST: async ({ request }: { request: Request }) => {
        return handleAuthRequest(request);
      },
    },
  },
});
