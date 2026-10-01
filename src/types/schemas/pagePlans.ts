import { z } from "zod";
import {
  PAGE_ACTIONS,
  PAGE_PERIOD_PATTERN,
  PAGE_ROLES,
  SITE_PAGE_SOURCES,
} from "@/shared/pagePlans";

// Optional text where `null` (or blank) clears the stored value and an omitted
// key leaves it untouched. These schemas are also published as MCP JSON
// Schema, so no transforms: the service normalizes blanks.
const clearableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const pageActionSchema = z.enum(PAGE_ACTIONS);

export const importSitePageSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe(
      'Absolute URL, or a path like "/ar/guide" resolved against the project domain. Normalized: https, lowercase host, no fragment or trailing slash.',
    ),
  language: clearableText(20).describe('Page language, e.g. "en" or "ar"'),
  routeFile: clearableText(500),
  contentFile: clearableText(500),
  title: clearableText(500),
  metaDescription: clearableText(1000),
  h1: clearableText(500),
  canonical: clearableText(2000),
  noindex: z.boolean().optional(),
  statusCode: z.number().int().min(100).max(599).nullable().optional(),
  pageRole: z
    .enum(PAGE_ROLES)
    .nullable()
    .optional()
    .describe(
      "Falls back to the role in the project's key pages when omitted for a new or unclassified page",
    ),
  inSitemap: z.boolean().optional(),
  source: z
    .enum(SITE_PAGE_SOURCES)
    .optional()
    .describe("Where the URL was found. Defaults to sitemap for new pages."),
  lastCheckedAt: z.string().max(40).nullable().optional(),
});
export type ImportSitePageInput = z.infer<typeof importSitePageSchema>;

export const listSitePagesFilterSchema = z.object({
  language: z.string().trim().max(20).optional(),
  statusCode: z.number().int().min(100).max(599).optional(),
  noindex: z.boolean().optional(),
  pageRole: z.enum(PAGE_ROLES).optional(),
  inSitemap: z.boolean().optional(),
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe("Substring match on URL, title or H1"),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});
export type ListSitePagesFilter = z.infer<typeof listSitePagesFilterSchema>;

export const clusterTargetSchema = z.object({
  clusterId: z.string().min(1),
  targetPageId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("A site page id from list_site_pages; null clears"),
  targetUrl: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .describe(
      "Proposed address of a page that does not exist yet; null clears",
    ),
  plannedAction: pageActionSchema.nullable().optional(),
  actionReason: clearableText(2000),
});
export type ClusterTargetInput = z.infer<typeof clusterTargetSchema>;

const score = z.number().min(0).max(100);

export const pagePlanItemInputSchema = z.object({
  action: pageActionSchema,
  targetUrl: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe(
      "Required unless sitePageId is given (then the page URL is used). A path is resolved against the project domain.",
    ),
  clusterId: z.string().min(1).optional(),
  sitePageId: z.string().min(1).optional(),
  language: z.string().trim().max(20).optional(),
  score: score.optional(),
  scoreReasons: z.string().trim().max(2000).optional(),
  confidence: score.optional(),
  estCostUsd: z.number().min(0).optional(),
  included: z.boolean().optional(),
});
export type PagePlanItemInput = z.infer<typeof pagePlanItemInputSchema>;

export const pagePeriodSchema = z
  .string()
  .regex(PAGE_PERIOD_PATTERN, "Use YYYY-MM");

// Server function inputs (web).
export const pagePlanPeriodInputSchema = z.object({
  projectId: z.string().min(1),
  period: pagePeriodSchema,
});

export const pagePlanIncludeInputSchema = z.object({
  projectId: z.string().min(1),
  planId: z.string().min(1),
  items: z
    .array(z.object({ itemId: z.string().min(1), included: z.boolean() }))
    .min(1)
    .max(500),
});

export const pagePlanApproveInputSchema = z.object({
  projectId: z.string().min(1),
  planId: z.string().min(1),
});
