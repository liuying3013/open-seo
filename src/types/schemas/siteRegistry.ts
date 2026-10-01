import { z } from "zod";
import {
  SITE_CONTENT_FORMATS,
  SITE_HOSTINGS,
  SITE_OPS_STATUSES,
  SITE_ROLES,
  SITE_TEMPLATE_FAMILIES,
} from "@/shared/siteRegistry";
import {
  isSupportedLanguageCode,
  isSupportedLocationCode,
} from "@/shared/keyword-locations";

// Optional text where `null` (or blank) clears the stored value and an omitted
// key leaves it untouched. No transforms: these schemas are also published as
// MCP JSON Schema; the service normalizes blanks.
const clearableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

export const siteMarketSchema = z.object({
  locationCode: z
    .number()
    .int()
    .refine(isSupportedLocationCode, "Unsupported DataForSEO location code"),
  languageCode: z
    .string()
    .refine(isSupportedLanguageCode, "Unsupported language code"),
  urlPrefix: z
    .string()
    .trim()
    .max(80)
    .nullable()
    .optional()
    .describe(
      'Path prefix of this market on the site, e.g. "/ar". Null or "/" means the site root.',
    ),
  isPrimary: z.boolean().optional(),
});

// Business-facing fields an operator edits by hand (overview page) or an agent
// sets in bulk (import). Each key is optional: omitted = unchanged.
const businessFields = {
  businessGroup: clearableText(80),
  brand: clearableText(80),
  siteRole: z.enum(SITE_ROLES).optional(),
  opsStatus: z.enum(SITE_OPS_STATUSES).optional(),
  notes: clearableText(2000),
};

export const importSiteSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .describe(
      'Site domain, e.g. "example.com". A protocol, "www." and trailing slash are ignored when matching an existing project.',
    ),
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe(
      "Project name used only when a new project is created. Defaults to the domain.",
    ),
  ...businessFields,
  githubRepo: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/, "Use owner/name")
    .nullable()
    .optional(),
  productionBranch: clearableText(120),
  hosting: z.enum(SITE_HOSTINGS).optional(),
  coolifyAppUuid: clearableText(80),
  coolifyServer: clearableText(120),
  autoDeploy: z.boolean().nullable().optional(),
  templateFamily: z.enum(SITE_TEMPLATE_FAMILIES).nullable().optional(),
  contentFormat: z.enum(SITE_CONTENT_FORMATS).optional(),
  plausibleSite: clearableText(255).describe(
    "Site domain as configured in Plausible.",
  ),
  gscProperty: clearableText(255).describe(
    'Search Console property, verbatim, e.g. "sc-domain:example.com". Informational; the GSC connection itself is made in the project.',
  ),
  markets: z
    .array(siteMarketSchema)
    .max(30)
    .optional()
    .describe(
      "Markets served, including the primary one. Only added or updated, never removed.",
    ),
});

export const updateSiteRowSchema = z.object({
  projectId: z.string().min(1),
  ...businessFields,
  // Full replacement of the market list (UI editor). Empty keeps the
  // fallback to the project's default market.
  markets: z.array(siteMarketSchema).max(30),
});

export type ImportSiteInput = z.infer<typeof importSiteSchema>;
export type SiteMarketInput = z.infer<typeof siteMarketSchema>;
export type UpdateSiteRowInput = z.infer<typeof updateSiteRowSchema>;
