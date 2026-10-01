import { index, pgTable, text } from "drizzle-orm/pg-core";
import { JOB_NAMES, JOB_RUN_STATUSES, JOB_TRIGGERS } from "@/shared/jobRuns";

// One row per background job invocation (Cloudflare cron or the internal HTTP
// trigger). Timestamps are ISO strings written by the app.
export const jobRuns = pgTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    job: text("job", { enum: JOB_NAMES }).notNull(),
    trigger: text("trigger", { enum: JOB_TRIGGERS }).notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    status: text("status", { enum: JOB_RUN_STATUSES }).notNull(),
    detail: text("detail"),
  },
  (table) => [index("job_runs_started_idx").on(table.startedAt)],
);
