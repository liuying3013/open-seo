import { withPgClient } from "@/db";
import { reconcileStaleAudits } from "@/server/features/audit/services/auditReconciler";
import { JobRunService } from "@/server/features/job-runs/services/JobRunService";
import { runScheduledRankChecks } from "@/server/features/rank-tracking/services/scheduledRankChecks";
import { getAuthMode, isHostedAuthMode } from "@/lib/auth-mode";
import { sweepDubReferredOrganizations } from "@/server/referrals/dub";
import type { JobName, JobTrigger } from "@/shared/jobRuns";

// Background jobs. Cloudflare cron triggers (src/server.ts `scheduled`) and the
// internal HTTP trigger (src/routes/api/internal/jobs/$job.ts) both land here,
// so a self-hosted install that cannot run cron gets identical behavior from a
// host-level scheduler.

const DAY_MS = 24 * 60 * 60 * 1000;

type JobOptions = {
  // Purges expired OAuth data from OAUTH_KV. Only the Cloudflare entrypoint
  // owns the OAuth provider, so only the hosted cron passes this.
  purgeOAuthData?: () => Promise<{ done: boolean }>;
};

// Watchdog first: reconcile audits stuck in "running" whose workflow died
// without reaching mark-failed (OOM/CPU kills, expired instances). Runs before
// the rank loop so a slow tick can't delay or starve it. Its failure is held
// until after the rank checks so it can't suppress them, then rethrown so the
// run still reports as failed.
async function runFrequent(env: Env) {
  let watchdogError: unknown;
  try {
    await reconcileStaleAudits();
  } catch (err) {
    watchdogError = err;
    console.error("[cron] Stale-audit reconcile failed:", err);
  }
  await runScheduledRankChecks(env);
  if (watchdogError) throw watchdogError;
  return { staleAuditWatchdog: "ok", rankChecks: "ok" };
}

async function runDaily(env: Env, options: JobOptions) {
  const errors: string[] = [];
  const summary: Record<string, unknown> = {};

  // Each retention step is independent: one failing must not skip the others.
  async function step(name: string, work: () => Promise<void>) {
    try {
      await work();
    } catch (err) {
      console.error(`[cron] ${name} failed:`, err);
      errors.push(
        `${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Content-ops SERP snapshot retention: drop snapshots older than 180 days,
  // keeping the newest 3 per keyword+device.
  await step("content-ops SERP prune", async () => {
    const { SerpRepository } =
      await import("@/server/features/content-ops/repositories/SerpRepository");
    const cutoff = new Date(Date.now() - 180 * DAY_MS).toISOString();
    const pruned = await SerpRepository.pruneOlderThan(cutoff, 3);
    summary.contentOpsSnapshotsPruned = pruned;
    if (pruned > 0) {
      console.log(`[content-ops] pruned ${pruned} old SERP snapshots`);
    }
  });

  // Opportunity-intel retention: snapshots older than 180 days are dropped
  // (newest 3 per keyword+location kept); REJECTED opportunities additionally
  // lose their raw result rows after 90 days (snapshot headers with gap
  // analysis survive).
  await step("opportunity-intel retention prune", async () => {
    const { OpportunitySerpRepository } =
      await import("@/server/features/opportunity-intel/repositories/OpportunitySerpRepository");
    const prunedSnapshots = await OpportunitySerpRepository.pruneOlderThan(
      new Date(Date.now() - 180 * DAY_MS).toISOString(),
      3,
    );
    const emptiedRejected =
      await OpportunitySerpRepository.deleteResultsForRejectedOlderThan(
        new Date(Date.now() - 90 * DAY_MS).toISOString(),
      );
    summary.opportunitySnapshotsPruned = prunedSnapshots;
    summary.opportunityRejectedEmptied = emptiedRejected;
    if (prunedSnapshots > 0 || emptiedRejected > 0) {
      console.log(
        `[opportunity-intel] pruned ${prunedSnapshots} snapshots, emptied ${emptiedRejected} rejected snapshots`,
      );
    }
  });

  await step("job run prune", async () => {
    summary.jobRunsPruned = await JobRunService.pruneOldRuns();
  });

  // Only hosted mode runs the OAuth provider (and has OAUTH_KV bound).
  if (isHostedAuthMode(getAuthMode(env.AUTH_MODE))) {
    if (options.purgeOAuthData) {
      const purge = options.purgeOAuthData;
      await step("mcp-oauth purge", async () => {
        const result = await purge();
        summary.oauthPurgeComplete = result.done;
        console.log("[mcp-oauth] purged expired OAuth data", result);
        if (!result.done) {
          // The sweep only advances past live records via deletions; a
          // persistent incomplete scan means the keyspace outgrew the batch.
          console.warn("[mcp-oauth] purge did not cover the full keyspace");
        }
      });
    }

    // Daily referral-sale sweep: catches paid Autumn invoices the
    // billing.updated webhook path misses (renewals, one-time top-ups).
    await step("Dub referral sale sweep", sweepDubReferredOrganizations);
  }

  if (errors.length > 0) throw new Error(errors.join("; "));
  return summary;
}

/**
 * Runs a named job and records it in job_runs. Throws if the job failed, after
 * the failure has been recorded.
 */
export function runJob(
  name: JobName,
  trigger: JobTrigger,
  env: Env,
  options: JobOptions = {},
) {
  // One request-scoped Postgres client for the whole run (no-op in D1 mode).
  return withPgClient(() =>
    JobRunService.runRecorded(name, trigger, () =>
      name === "frequent" ? runFrequent(env) : runDaily(env, options),
    ),
  );
}
