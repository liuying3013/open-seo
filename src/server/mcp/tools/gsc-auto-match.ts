import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { GscAutoMatchService } from "@/server/features/gsc/services/GscAutoMatchService";
import { mcpResponse } from "@/server/mcp/formatters";
import type { ToolContext } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { buildDashboardUrl } from "@/server/mcp/urls";

// Account-level tool: it spans every project in the caller's organization and
// every Google account the caller has linked, so there is no projectId.

export const autoMatchGscPropertiesTool = {
  name: "auto_match_gsc_properties",
  config: {
    title: "Auto-match Search Console properties",
    description:
      'Connects projects that have no Search Console connection yet to the property that covers their domain, searching across all Google accounts linked to the caller. Preference: domain property "sc-domain:example.com", then "https://example.com/", then "https://www.example.com/"; unverified properties are ignored. Projects that already have a connection are never changed. A real run also records the property in the site registry (gscProperty). Defaults to dryRun true, which only returns the plan: matched (with account and property), unmatched (with a reason: no_matching_property, unverified_only, no_domain, no_accessible_accounts) and skipped (already connected). Pass dryRun false to apply. Requires a linked Google account (see hasGoogleAccount). Uses no credits.',
    inputSchema: {
      dryRun: z
        .boolean()
        .default(true)
        .describe("When true (default), return the plan without writing."),
    },
    outputSchema: z.looseObject({
      dryRun: z.boolean(),
      hasGoogleAccount: z.boolean(),
      googleOAuthConfigured: z.boolean(),
      accounts: z.array(looseObjectOutputSchema),
      matched: z.array(looseObjectOutputSchema),
      unmatched: z.array(looseObjectOutputSchema),
      skipped: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  handler: async (args: { dryRun: boolean }, context: ToolContext) => {
    if (!args.dryRun) {
      requireOrgPermission(context.auth, { integration: ["manage"] });
    }
    const result = await GscAutoMatchService.autoMatch({
      organizationId: context.auth.organizationId,
      userId: context.auth.userId,
      dryRun: args.dryRun,
    });
    const header = result.hasGoogleAccount
      ? `${result.dryRun ? "Plan" : "Applied"}: ${result.matched.length} matched, ${result.unmatched.length} unmatched, ${result.skipped.length} already connected.`
      : "No Google account is linked to this user, so there is nothing to match. Link one in the app (Search Console connection card), which needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and BETTER_AUTH_SECRET on the server.";
    const lines = [
      ...result.matched.map(
        (item) =>
          `+ ${item.domain}  ->  ${item.siteUrl}  (${item.accountEmail ?? item.accountId})${result.dryRun ? "" : item.applied ? "  connected" : `  FAILED: ${item.error ?? "unknown"}`}`,
      ),
      ...result.unmatched.map(
        (item) => `- ${item.domain ?? item.projectId}  ${item.reason}`,
      ),
    ];
    return mcpResponse({
      text: [header, ...lines].join("\n"),
      meta: { url: buildDashboardUrl(context.auth.baseUrl, "/sites") },
      structuredContent: result,
    });
  },
};
