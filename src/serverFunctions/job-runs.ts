import { createServerFn } from "@tanstack/react-start";
import { JobRunService } from "@/server/features/job-runs/services/JobRunService";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";

// Run history is install-wide operational data, so it is only shown on
// self-hosted installs (hosted has a single operator and Cloudflare's own logs).
export const listJobRuns = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async () =>
    (await isHostedServerAuthMode()) ? [] : JobRunService.listRecent(),
  );
