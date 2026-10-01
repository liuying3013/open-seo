import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { SiteRegistryService } from "@/server/features/site-registry/services/SiteRegistryService";
import { mcpResponse } from "@/server/mcp/formatters";
import type { ToolContext } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { buildDashboardUrl } from "@/server/mcp/urls";
import { importSiteSchema } from "@/types/schemas/siteRegistry";

// Site-registry tools are account-level: one project per site, listed across
// the caller's organization, so there is no projectId argument.

export const listSitesTool = {
  name: "list_sites",
  config: {
    title: "List sites",
    description:
      "Lists every project with its site registry: domain, business group, brand, role, ops status, repository and branch, hosting, template family, content format, markets, whether Search Console is connected, and the Plausible status (plausibleStatus: not_configured = no site mapped, unconnected = site mapped but the server has no Plausible API key, connected). Uses no credits. Fields shown as null are unknown or not connected, not empty by design. Projects without a registry row (for example research workspaces) appear with registry null. Markets fall back to the project's default market when none are recorded.",
    inputSchema: {} as Record<string, never>,
    outputSchema: z.looseObject({
      sites: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: async (_args: Record<string, never>, context: ToolContext) => {
    const { baseUrl, organizationId } = context.auth;
    const sites = await SiteRegistryService.listSites(organizationId);
    const lines = sites.map((site) => {
      const registry = site.registry;
      const markets = site.markets
        .map((market) => `${market.locationCode}/${market.languageCode}`)
        .join(",");
      return `- ${site.projectId}  ${site.domain ?? site.name}  ${registry?.opsStatus ?? "unregistered"}  repo:${registry?.githubRepo ?? "unknown"}@${registry?.productionBranch ?? "?"}  markets:${markets}  gsc:${site.gscConnected ? "yes" : "no"}  plausible:${site.plausibleStatus}`;
    });
    return mcpResponse({
      text: `Sites (${sites.length}):\n${lines.join("\n")}`,
      meta: { url: buildDashboardUrl(baseUrl, "/sites") },
      structuredContent: {
        sites: sites.map((site) => ({
          ...site,
          url: buildDashboardUrl(baseUrl, `/p/${site.projectId}`),
        })),
      },
    });
  },
};

export const upsertSiteRegistryTool = {
  name: "upsert_site_registry",
  config: {
    title: "Upsert site registry",
    description:
      'Bulk, idempotent import of site registry data. Each site is matched to an existing project by normalized domain (protocol, "www." and trailing slash ignored, lowercase); with no match a new project is created in the caller\'s organization (name defaults to the domain). Omitted fields are left unchanged; null or "" clears a field. Markets (location + language, optional urlPrefix like "/ar", one isPrimary) are added or updated, never removed; the project\'s default market follows the primary market. Never deletes projects, registry rows or markets. Uses no credits. Returns per site {domain, projectId, status: created|updated|unchanged, changes}. Call list_sites first to see current state.',
    inputSchema: { sites: z.array(importSiteSchema).min(1).max(100) },
    outputSchema: z.looseObject({
      results: z.array(looseObjectOutputSchema),
      created: z.number(),
      updated: z.number(),
      unchanged: z.number(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  handler: async (
    args: { sites: z.infer<typeof importSiteSchema>[] },
    context: ToolContext,
  ) => {
    requireOrgPermission(context.auth, { project: ["create"] });
    const results = await SiteRegistryService.upsertSites({
      organizationId: context.auth.organizationId,
      userId: context.auth.userId,
      sites: args.sites,
    });
    const count = (status: string) =>
      results.filter((result) => result.status === status).length;
    const created = count("created");
    const updated = count("updated");
    const unchanged = count("unchanged");
    return mcpResponse({
      text: `Sites: ${created} created, ${updated} updated, ${unchanged} unchanged.\n${results
        .map(
          (result) =>
            `- ${result.domain}  ${result.status}  ${result.projectId}${result.changes.length > 0 ? `  [${result.changes.join(", ")}]` : ""}`,
        )
        .join("\n")}`,
      meta: { url: buildDashboardUrl(context.auth.baseUrl, "/sites") },
      structuredContent: { results, created, updated, unchanged },
    });
  },
};
