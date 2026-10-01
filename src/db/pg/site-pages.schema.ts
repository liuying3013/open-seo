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
import { PAGE_ROLES, SITE_PAGE_SOURCES } from "../../shared/pagePlans";

// Timestamps are text on Postgres; see ./app.schema.ts for why.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// The page inventory of a site: one row per live (or planned) URL, with the
// source files behind it. Clusters point at a row here as their target page.
export const sitePages = pgTable(
  "site_pages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Canonical absolute URL (see normalizePageUrl).
    url: text("url").notNull(),
    path: text("path").notNull(),
    language: text("language"),
    routeFile: text("route_file"),
    contentFile: text("content_file"),
    title: text("title"),
    metaDescription: text("meta_description"),
    h1: text("h1"),
    canonical: text("canonical"),
    noindex: boolean("noindex").notNull().default(false),
    statusCode: integer("status_code"),
    pageRole: text("page_role", { enum: PAGE_ROLES }),
    inSitemap: boolean("in_sitemap").notNull().default(true),
    source: text("source", { enum: SITE_PAGE_SOURCES })
      .notNull()
      .default("manual"),
    lastCheckedAt: text("last_checked_at"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("site_pages_project_url_idx").on(table.projectId, table.url),
    index("site_pages_project_language_idx").on(
      table.projectId,
      table.language,
    ),
  ],
);
