import { z } from "zod";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { rethrowAsAppError } from "@/server/features/page-plans/pagePlanErrors";
import { PagePlansService } from "@/server/features/page-plans/services/PagePlansService";
import { SitePagesService } from "@/server/features/page-plans/services/SitePagesService";
import {
  clusterTargetSchema,
  importSitePageSchema,
  listSitePagesFilterSchema,
  pagePeriodSchema,
  pagePlanItemInputSchema,
  type ClusterTargetInput,
  type ImportSitePageInput,
  type ListSitePagesFilter,
  type PagePlanItemInput,
} from "@/types/schemas/pagePlans";

// Page inventory, cluster-to-page targets and the monthly page plan. Approving
// a plan is deliberately not a tool: only a signed-in web user can do it.

const sitePagesPath = (projectId: string) => `/p/${projectId}/site-pages`;
const pagePlansPath = (projectId: string) => `/p/${projectId}/page-plans`;

export const importSitePagesTool = {
  name: "import_site_pages",
  config: {
    title: "Import site pages",
    description:
      'Bulk, idempotent upsert of the site\'s page inventory, matched by (project, normalized URL): https, lowercase host, no fragment or trailing slash; a path like "/ar/guide" is resolved against the project domain. Omitted fields are left unchanged; null or "" clears a text field. A page listed in the project\'s key pages gets its role unless one is given. URLs on other domains and invalid URLs are rejected per row (returned in `rejected`), the rest are still imported. Never deletes pages. Set markMissingOutOfSitemap=true ONLY when the call carries the complete sitemap: pages of the project that are not in it get inSitemap=false. Typical rows come from scripts/map-site-routes.ts ({url, routeFile, contentFile}) plus title/h1/statusCode from a crawl. Free.',
    inputSchema: {
      projectId: projectIdSchema,
      pages: z.array(importSitePageSchema).min(1).max(1000),
      markMissingOutOfSitemap: z.boolean().optional(),
    },
    outputSchema: z.looseObject({
      created: z.number(),
      updated: z.number(),
      unchanged: z.number(),
      markedOutOfSitemap: z.number(),
      rejected: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        pages: ImportSitePageInput[];
        markMissingOutOfSitemap?: boolean;
      },
      context,
    ) => {
      const result = await SitePagesService.importPages({
        projectId: args.projectId,
        pages: args.pages,
        markMissingOutOfSitemap: args.markMissingOutOfSitemap,
      }).catch(rethrowAsAppError);
      const rejectedText = result.rejected
        .map((row) => `\n- ${row.url}: ${row.reason}`)
        .join("");
      return mcpResponse({
        text: `Site pages: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.markedOutOfSitemap} marked out of sitemap, ${result.rejected.length} rejected.${rejectedText}`,
        structuredContent: result,
        meta: buildProjectMeta(
          context,
          args.projectId,
          sitePagesPath(args.projectId),
        ),
      });
    },
  ),
};

export const listSitePagesTool = {
  name: "list_site_pages",
  config: {
    title: "List site pages",
    description:
      "Lists the site's page inventory (url, language, title, route/content file, status code, noindex, role, inSitemap) with clusterCount = how many clusters target the page. Filter by language, status code, noindex, role, inSitemap or a substring of URL/title/H1. Returns up to `limit` (default 200) rows plus the total. Use the returned ids as targetPageId in set_cluster_targets and sitePageId in create_page_plan. Free.",
    inputSchema: {
      projectId: projectIdSchema,
      ...listSitePagesFilterSchema.shape,
    },
    outputSchema: z.looseObject({
      pages: z.array(looseObjectOutputSchema),
      total: z.number(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string } & ListSitePagesFilter, context) => {
      const { projectId, ...filter } = args;
      const { rows, total } = await SitePagesService.list(projectId, filter);
      const lines = rows.map(
        (page) =>
          `- ${page.id}  ${page.url}  ${page.language ?? "-"}  ${page.statusCode ?? "-"}${page.noindex ? "  noindex" : ""}  ${page.pageRole ?? "-"}  clusters:${page.clusterCount}`,
      );
      return mcpResponse({
        text: `Site pages (${rows.length} of ${total}):\n${lines.join("\n")}`,
        structuredContent: { pages: rows, total },
        meta: buildProjectMeta(context, projectId, sitePagesPath(projectId)),
      });
    },
  ),
};

export const setClusterTargetsTool = {
  name: "set_cluster_targets",
  config: {
    title: "Set cluster target pages",
    description:
      "Batch-set which page each cluster should land on and what to do there. Per cluster: targetPageId (an existing site page of THIS project), targetUrl (proposed address of a page that does not exist yet), plannedAction (new | update | add_section | merge | watch | exclude) and actionReason. Omitted fields are unchanged; null clears. Fails the whole call if a cluster or target page is not in the project. Free.",
    inputSchema: {
      projectId: projectIdSchema,
      targets: z.array(clusterTargetSchema).min(1).max(200),
    },
    outputSchema: z.looseObject({
      updated: z.number(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  handler: withMcpProjectAuth(
    async (
      args: { projectId: string; targets: ClusterTargetInput[] },
      context,
    ) => {
      const result = await SitePagesService.setClusterTargets(
        args.projectId,
        args.targets,
      ).catch(rethrowAsAppError);
      return mcpResponse({
        text: `Updated targets on ${result.updated} cluster(s).`,
        structuredContent: result,
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/content-ops`,
        ),
      });
    },
  ),
};

export const createPagePlanTool = {
  name: "create_page_plan",
  config: {
    title: "Create monthly page plan",
    description:
      "Creates the DRAFT page plan for a month (period YYYY-MM), or replaces the items of that month's existing draft; a project has one plan per month. An approved plan cannot be changed. Each item: action (new | update | add_section | merge | watch | exclude), targetUrl (or sitePageId), optional clusterId, language, score and confidence (0-100), scoreReasons, estCostUsd, included. An item whose URL is already in the page inventory is linked to that page. A human approves the plan in the web app, which then creates a work order for every included new/update/add_section/merge item (those need a clusterId). Free.",
    inputSchema: {
      projectId: projectIdSchema,
      period: pagePeriodSchema,
      notes: z.string().trim().max(4000).optional(),
      items: z.array(pagePlanItemInputSchema).min(1).max(200),
    },
    outputSchema: z.looseObject({
      planId: z.string(),
      period: z.string(),
      status: z.string(),
      items: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        period: string;
        notes?: string;
        items: PagePlanItemInput[];
      },
      context,
    ) => {
      const { plan, items } =
        await PagePlansService.createDraft(args).catch(rethrowAsAppError);
      return mcpResponse({
        text: `Draft page plan ${plan.period} saved with ${items.length} item(s). A human must approve it in the web app (Page plans) before work orders are created.`,
        structuredContent: {
          planId: plan.id,
          period: plan.period,
          status: plan.status,
          items,
        },
        meta: buildProjectMeta(
          context,
          args.projectId,
          pagePlansPath(args.projectId),
        ),
      });
    },
  ),
};
