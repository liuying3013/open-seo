import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";

// Curated shortlist for content work. Not the opportunity dump.
export const candidateKeywords = sqliteTable(
  "candidate_keywords",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    locationCode: integer("location_code").notNull().default(2840),
    languageCode: text("language_code").notNull().default("en"),
    source: text("source"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex(
      "candidate_keywords_unique_project_keyword_location_language",
    ).on(
      table.projectId,
      table.keyword,
      table.locationCode,
      table.languageCode,
    ),
    index("candidate_keywords_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);
