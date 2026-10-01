import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import {
  SITE_CONTENT_FORMATS,
  SITE_HOSTINGS,
  SITE_OPS_STATUSES,
  SITE_ROLES,
  SITE_TEMPLATE_FAMILIES,
} from "../../shared/siteRegistry";

// Timestamps are text on Postgres; see ./app.schema.ts for why.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// One registry row per project (one site = one project). Null columns mean
// "not connected / unknown"; the UI renders them that way instead of guessing.
export const projectSites = pgTable("project_sites", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Canonical domain (see normalizeSiteDomain).
  domain: text("domain"),
  businessGroup: text("business_group"),
  brand: text("brand"),
  siteRole: text("site_role", { enum: SITE_ROLES }).notNull().default("other"),
  opsStatus: text("ops_status", { enum: SITE_OPS_STATUSES })
    .notNull()
    .default("pending"),
  // Repository and publishing.
  githubRepo: text("github_repo"),
  productionBranch: text("production_branch"),
  hosting: text("hosting", { enum: SITE_HOSTINGS })
    .notNull()
    .default("unknown"),
  coolifyAppUuid: text("coolify_app_uuid"),
  coolifyServer: text("coolify_server"),
  autoDeploy: boolean("auto_deploy"),
  // Content adaptation.
  templateFamily: text("template_family", { enum: SITE_TEMPLATE_FAMILIES }),
  contentFormat: text("content_format", { enum: SITE_CONTENT_FORMATS })
    .notNull()
    .default("unknown"),
  // Data mapping.
  plausibleSite: text("plausible_site"),
  gscProperty: text("gsc_property"),
  notes: text("notes"),
  importedAt: text("imported_at"),
  updatedAt: text("updated_at").notNull().default(isoNow),
  updatedBy: text("updated_by"),
});

// Markets a site serves. Projects without rows here fall back to
// projects.location_code / language_code as their single primary market.
export const projectMarkets = pgTable(
  "project_markets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    // URL prefix of this market on the site, e.g. "/ar". Null = site root.
    urlPrefix: text("url_prefix"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("project_markets_unique_project_location_language").on(
      table.projectId,
      table.locationCode,
      table.languageCode,
    ),
    // At most one primary market per project.
    uniqueIndex("project_markets_one_primary_per_project_idx")
      .on(table.projectId)
      .where(sql`${table.isPrimary}`),
    index("project_markets_project_idx").on(table.projectId),
  ],
);
