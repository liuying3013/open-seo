import { JobRunRepository } from "@/server/features/job-runs/repositories/JobRunRepository";
import type { JobName, JobTrigger } from "@/shared/jobRuns";

const DETAIL_MAX_LENGTH = 1000;
const RETENTION_DAYS = 90;
const RECENT_RUNS_LIMIT = 50;

function truncate(text: string) {
  return text.length > DETAIL_MAX_LENGTH
    ? `${text.slice(0, DETAIL_MAX_LENGTH - 1)}…`
    : text;
}

// Run records are an audit trail, not part of the job: a failure to write one
// is logged and never changes the job's own outcome.
async function bestEffort(label: string, write: () => Promise<unknown>) {
  try {
    await write();
  } catch (error) {
    console.error(`[job-runs] could not ${label}:`, error);
  }
}

/** Runs `work`, recording a job_runs row for it, and returns its summary. */
async function runRecorded<T extends Record<string, unknown>>(
  job: JobName,
  trigger: JobTrigger,
  work: () => Promise<T>,
): Promise<T> {
  const id = crypto.randomUUID();
  await bestEffort("record job start", () =>
    JobRunRepository.start({
      id,
      job,
      trigger,
      startedAt: new Date().toISOString(),
    }),
  );

  try {
    const summary = await work();
    await bestEffort("record job result", () =>
      JobRunRepository.finish(id, {
        status: "succeeded",
        finishedAt: new Date().toISOString(),
        detail: truncate(JSON.stringify(summary)),
      }),
    );
    return summary;
  } catch (error) {
    await bestEffort("record job failure", () =>
      JobRunRepository.finish(id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        detail: truncate(
          error instanceof Error ? error.message : String(error),
        ),
      }),
    );
    throw error;
  }
}

function listRecent() {
  return JobRunRepository.listRecent(RECENT_RUNS_LIMIT);
}

function pruneOldRuns() {
  return JobRunRepository.deleteStartedBefore(
    new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  );
}

export const JobRunService = { runRecorded, listRecent, pruneOldRuns };
