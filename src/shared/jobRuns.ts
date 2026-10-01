// Background jobs the scheduler can run, and the closed value sets for their
// run records. Shared by both DB dialect schemas, the job runner, the internal
// trigger route and the settings UI.

export const JOB_NAMES = ["frequent", "daily"] as const;
export const JOB_TRIGGERS = ["cron", "http"] as const;
export const JOB_RUN_STATUSES = ["running", "succeeded", "failed"] as const;

export type JobName = (typeof JOB_NAMES)[number];
export type JobTrigger = (typeof JOB_TRIGGERS)[number];
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];
