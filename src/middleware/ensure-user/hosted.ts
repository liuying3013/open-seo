import { env } from "cloudflare:workers";
import { getAuth, hasPasswordAuthConfig } from "@/lib/auth";
import { getAuthMode } from "@/lib/auth-mode";
import { getActiveOrganizationId } from "@/lib/auth-session";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { resolveActiveHostedOrganization } from "@/server/auth/default-hosted-organization";
import { AppError } from "@/server/lib/errors";
import type { EnsuredUserContext } from "./types";

async function requireHostedSession(headers: Headers) {
  if (!hasPasswordAuthConfig()) {
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      "Missing password authentication configuration",
    );
  }

  const session = await getAuth().api.getSession({ headers });

  if (!session?.user?.id || !session.user.email) {
    throw new AppError("UNAUTHENTICATED");
  }

  return session;
}

export async function resolveHostedContext(
  headers: Headers,
): Promise<EnsuredUserContext> {
  const session = await requireHostedSession(headers);
  const activeOrganizationId = getActiveOrganizationId(session);

  if (activeOrganizationId) {
    // The session's activeOrganizationId is only a hint (it can outlive a
    // membership: removal, org deletion, cookie cache). The member row is the
    // authorization fact and also carries the caller's role.
    const membership = await AuthRepository.getMembership(
      session.user.id,
      activeOrganizationId,
    );

    if (membership) {
      return {
        userId: session.user.id,
        userEmail: session.user.email,
        emailVerified: session.user.emailVerified ?? false,
        organizationId: activeOrganizationId,
        role: membership.role,
      };
    }
  }

  // No active org, or a stale one: re-resolve from live memberships (creating
  // a default workspace only when the user has none) and repoint the session.
  const authApi = getAuth().api;
  const resolved =
    getAuthMode(env.AUTH_MODE) === "local_password"
      ? await AuthRepository.findNewestMembershipForUser(session.user.id)
      : await resolveActiveHostedOrganization(session.user.id, (body) =>
          authApi.createOrganization({ body }),
        );
  if (!resolved)
    throw new AppError(
      "FORBIDDEN",
      "No workspace access is configured for this account.",
    );

  await authApi.setActiveOrganization({
    headers,
    body: { organizationId: resolved.organizationId },
  });

  return {
    userId: session.user.id,
    userEmail: session.user.email,
    emailVerified: session.user.emailVerified ?? false,
    organizationId: resolved.organizationId,
    role: resolved.role,
  };
}
