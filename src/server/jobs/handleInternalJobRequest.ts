import { runJob } from "@/server/jobs/runJob";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { timingSafeEqual } from "@/server/lib/timing-safe-equal";
import { JOB_NAMES, type JobName } from "@/shared/jobRuns";

function isJobName(name: string): name is JobName {
  return JOB_NAMES.some((jobName) => jobName === name);
}

const notFound = () => new Response("Not found", { status: 404 });

/**
 * POST /api/internal/jobs/<job>: lets a host-level scheduler (cron, systemd
 * timer) run the same background jobs Cloudflare cron triggers would. Closed
 * (404) unless INTERNAL_JOBS_TOKEN is set; callers authenticate with
 * `Authorization: Bearer <INTERNAL_JOBS_TOKEN>`.
 */
export async function handleInternalJobRequest(
  request: Request,
  jobName: string,
  env: Env,
): Promise<Response> {
  const token = (await getOptionalEnvValue("INTERNAL_JOBS_TOKEN"))?.trim();
  if (!token) return notFound();

  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const presented = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(presented, `Bearer ${token}`)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  if (!isJobName(jobName)) return notFound();

  try {
    const summary = await runJob(jobName, "http", env);
    return Response.json({ job: jobName, status: "succeeded", summary });
  } catch (error) {
    return Response.json(
      {
        job: jobName,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
