import { desc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { jobRuns } from "@/db/schema";
import type { JobName, JobRunStatus, JobTrigger } from "@/shared/jobRuns";

async function start(input: {
  id: string;
  job: JobName;
  trigger: JobTrigger;
  startedAt: string;
}) {
  await db.insert(jobRuns).values({ ...input, status: "running" });
}

async function finish(
  id: string,
  input: { status: JobRunStatus; finishedAt: string; detail: string },
) {
  await db.update(jobRuns).set(input).where(eq(jobRuns.id, id));
}

function listRecent(limit: number) {
  return db
    .select()
    .from(jobRuns)
    .orderBy(desc(jobRuns.startedAt), desc(jobRuns.id))
    .limit(limit);
}

async function deleteStartedBefore(startedAt: string) {
  const deleted = await db
    .delete(jobRuns)
    .where(lt(jobRuns.startedAt, startedAt))
    .returning({ id: jobRuns.id });
  return deleted.length;
}

export const JobRunRepository = {
  start,
  finish,
  listRecent,
  deleteStartedBefore,
};
