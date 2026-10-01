import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { handleInternalJobRequest } from "@/server/jobs/handleInternalJobRequest";

// Host-level scheduler entrypoint for self-hosted installs, where Cloudflare
// cron triggers do not run. Closed unless INTERNAL_JOBS_TOKEN is set.
const handle = ({
  request,
  params,
}: {
  request: Request;
  params: { job: string };
}) => handleInternalJobRequest(request, params.job, env);

export const Route = createFileRoute("/api/internal/jobs/$job")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
});
