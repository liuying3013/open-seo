// Per-site work of one publisher run: unapproved-change detection, publishing
// due work orders, and rollbacks. One step per log line.

import path from "node:path";
import type { CoolifyClient } from "./coolify";
import {
  commitsBetween,
  errorMessage,
  git,
  prepareRevert,
  prepareSquashCommit,
  pushCommit,
} from "./git";
import { verifyLive } from "./live-check";
import type {
  OpenSeoClient,
  PublishItem,
  RecordAttemptArgs,
  RollbackItem,
} from "./openseo-client";
import { planRun } from "./queue";
import { captureScreenshots } from "./screenshots";
import {
  publisherDir,
  saveState,
  type PublisherState,
  type RepoState,
} from "./state";

export type RunContext = {
  openseo: OpenSeoClient;
  coolify: CoolifyClient | null;
  sitesDir: string;
  dryRun: boolean;
  state: PublisherState;
  counts: {
    published: number;
    rolledBack: number;
    unverified: number;
    failed: number;
    skipped: number;
  };
  log: (line: string) => void;
};

export type SiteJob = {
  projectId: string;
  label: string;
  repoName: string;
  productionBranch: string;
  autoDeploy: boolean;
  coolifyAppUuid: string | null;
};

type Stage = "merge" | "push" | "deploy" | "verify";

const REPORT_CHUNK = 200;
const LIVE_WAIT_MS = 6 * 60_000;

const short = (sha: string) => sha.slice(0, 8);

function repoState(ctx: RunContext, job: SiteJob, head: string): RepoState {
  return (ctx.state.repos[job.repoName] ??= {
    lastSha: head,
    ownShas: [],
    handledApprovals: [],
  });
}

/** Commits on origin/<prod> since the last run that this publisher did not push. */
async function detectChanges(ctx: RunContext, job: SiteJob, cloneDir: string) {
  const head = git(cloneDir, ["rev-parse", `origin/${job.productionBranch}`]);
  const known = ctx.state.repos[job.repoName];
  if (!known) {
    ctx.log(`${job.label}: first run, baseline set at ${short(head)}`);
    repoState(ctx, job, head);
    return;
  }
  if (known.lastSha === head) return;

  const commits = commitsBetween(cloneDir, known.lastSha, head);
  if (!commits) {
    ctx.log(
      `${job.label}: history was rewritten, baseline reset to ${short(head)}`,
    );
    known.lastSha = head;
    return;
  }
  const own = new Set(known.ownShas);
  const foreign = commits.filter((commit) => !own.has(commit.sha));
  if (foreign.length > 0) {
    ctx.log(
      `${job.label}: ${foreign.length} unapproved commit(s) on ${job.productionBranch}`,
    );
    if (!ctx.dryRun) {
      for (let i = 0; i < foreign.length; i += REPORT_CHUNK) {
        await ctx.openseo.reportSiteChanges(
          job.projectId,
          foreign.slice(i, i + REPORT_CHUNK).map((commit) => ({
            sha: commit.sha,
            author: commit.author.slice(0, 200),
            message: commit.message.slice(0, 1000),
          })),
        );
      }
    }
  }
  known.lastSha = head;
}

async function deploy(ctx: RunContext, job: SiteJob, commit: string) {
  const coolify = ctx.coolify;
  const appUuid = job.coolifyAppUuid;
  if (!coolify || !appUuid)
    throw new Error("Coolify is not configured for this site.");
  const uuid = job.autoDeploy
    ? await coolify.findOrTriggerDeployment(appUuid, commit)
    : await coolify.triggerDeploy(appUuid);
  return { uuid, wait: () => coolify.waitForDeployment(uuid) };
}

/** Push with one fetch-and-rebuild retry when origin moved meanwhile. */
async function buildAndPush(
  job: SiteJob,
  cloneDir: string,
  worktreeDir: string,
  build: () =>
    | { ok: true; commit: string }
    | { ok: false; stage: Stage | "fingerprint"; message: string },
): Promise<
  | { ok: true; commit: string }
  | { ok: false; stage: Stage | "fingerprint"; message: string }
> {
  for (let attempt = 0; ; attempt += 1) {
    const built = build();
    if (!built.ok) return built;
    const pushed = pushCommit(worktreeDir, built.commit, job.productionBranch);
    if (pushed.ok) return built;
    if (!pushed.nonFastForward || attempt > 0) {
      return { ok: false, stage: "push", message: pushed.message };
    }
    git(cloneDir, ["fetch", "origin"]);
  }
}

function rememberPush(
  ctx: RunContext,
  job: SiteJob,
  commit: string,
  approvalId?: string,
) {
  const state = ctx.state.repos[job.repoName];
  state.ownShas.push(commit);
  if (approvalId) state.handledApprovals.push(approvalId);
  saveState(ctx.sitesDir, ctx.state);
}

async function publishItem(ctx: RunContext, job: SiteJob, item: PublishItem) {
  const { openseo, log } = ctx;
  const tag = `${job.label}: asset ${item.assetId} v${item.version}`;
  if (!item.targetUrl) {
    log(`${tag}: FAILED no target URL on the work order, nothing pushed`);
    ctx.counts.failed += 1;
    return;
  }
  if (!ctx.coolify || !job.coolifyAppUuid) {
    log(`${tag}: FAILED no Coolify app configured, nothing pushed`);
    ctx.counts.failed += 1;
    return;
  }

  const cloneDir = path.join(ctx.sitesDir, job.repoName);
  const worktreeDir = path.join(publisherDir(ctx.sitesDir), job.repoName);
  const { attemptId } = await openseo.recordAttempt({
    projectId: job.projectId,
    assetId: item.assetId,
    approvalId: item.approvalId,
    status: "publishing",
  });
  log(`${tag}: attempt ${attemptId} started`);

  let stage: Stage | "fingerprint" = "merge";
  const fail = async (errorStage: Stage | "fingerprint", message: string) => {
    log(`${tag}: FAILED at ${errorStage}: ${message}`);
    ctx.counts.failed += 1;
    await openseo.recordAttempt({
      projectId: job.projectId,
      attemptId,
      status: "failed",
      errorStage,
      errorMessage: message,
    });
  };

  try {
    const title = item.title ?? item.draft.title;
    const result = await buildAndPush(job, cloneDir, worktreeDir, () =>
      prepareSquashCommit({
        repoDir: cloneDir,
        worktreeDir,
        productionBranch: job.productionBranch,
        taskBranch: item.taskBranch,
        approvedPatchId: item.approvedPatchId,
        approvedHeadCommit: item.headCommit,
        commitMessage: `Publish: ${title} (asset ${item.assetId} v${item.version})`,
      }),
    );
    if (!result.ok) return await fail(result.stage, result.message);
    const mergeCommit = result.commit;
    rememberPush(ctx, job, mergeCommit, item.approvalId);
    log(`${tag}: pushed ${short(mergeCommit)} to ${job.productionBranch}`);

    stage = "deploy";
    const deployment = await deploy(ctx, job, mergeCommit);
    log(`${tag}: deployment ${deployment.uuid}`);
    await openseo.recordAttempt({
      projectId: job.projectId,
      attemptId,
      status: "deploying",
      mergeCommit,
      coolifyDeploymentUuid: deployment.uuid,
    });
    const deployFailure = await deployment.wait();
    if (deployFailure) return await fail("deploy", deployFailure);
    log(`${tag}: deployment finished, verifying ${item.targetUrl}`);

    stage = "verify";
    await openseo.recordAttempt({
      projectId: job.projectId,
      attemptId,
      status: "verifying",
    });
    const live = await verifyLive(item.targetUrl, item.draft, LIVE_WAIT_MS);
    log(
      `${tag}: live status ${live.statusCode} noindex=${live.noindex} textMatch=${live.textMatch}`,
    );

    const shots = await captureScreenshots(item.targetUrl).catch((error) => ({
      desktop: undefined,
      mobile: undefined,
      errors: [errorMessage(error)],
    }));
    const notes = [live.notes, ...shots.errors].filter(Boolean).join(" ");
    const final = await openseo.recordAttempt({
      projectId: job.projectId,
      attemptId,
      status: "published",
      mergeCommit,
      liveStatusCode: live.statusCode ?? undefined,
      textMatch: live.textMatch,
      liveCheck: {
        noindex: live.noindex,
        canonical: live.canonical,
        ...(notes && { notes: notes.slice(0, 2000) }),
      },
      publishedUrl: item.targetUrl,
      screenshotDesktopPngBase64: shots.desktop,
      screenshotMobilePngBase64: shots.mobile,
    });
    if (final.status === "published") {
      ctx.counts.published += 1;
      log(`${tag}: published`);
    } else {
      ctx.counts.unverified += 1;
      log(`${tag}: UNVERIFIED ${final.reason ?? ""}`);
    }
  } catch (error) {
    await fail(stage, errorMessage(error)).catch((recordError) =>
      log(`${tag}: could not record failure: ${errorMessage(recordError)}`),
    );
  }
}

async function rollbackItem(ctx: RunContext, job: SiteJob, item: RollbackItem) {
  const { openseo, log } = ctx;
  const tag = `${job.label}: rollback of asset ${item.assetId}`;
  const base: RecordAttemptArgs = {
    projectId: job.projectId,
    attemptId: item.attemptId,
    status: "failed",
  };
  const failWith = async (errorStage: Stage, message: string) => {
    log(`${tag}: FAILED at ${errorStage}: ${message}`);
    ctx.counts.failed += 1;
    await openseo.recordAttempt({ ...base, errorStage, errorMessage: message });
  };

  if (!item.mergeCommit)
    return failWith(
      "merge",
      "No published merge commit is recorded for this work order.",
    );
  if (!ctx.coolify || !job.coolifyAppUuid)
    return failWith("deploy", "No Coolify app configured.");

  const cloneDir = path.join(ctx.sitesDir, job.repoName);
  const worktreeDir = path.join(publisherDir(ctx.sitesDir), job.repoName);
  let stage: Stage = "merge";
  try {
    await openseo.recordAttempt({ ...base, status: "publishing" });
    const result = await buildAndPush(job, cloneDir, worktreeDir, () => {
      const reverted = prepareRevert({
        repoDir: cloneDir,
        worktreeDir,
        productionBranch: job.productionBranch,
        commit: item.mergeCommit!,
      });
      return reverted.ok
        ? reverted
        : { ok: false, stage: "merge", message: reverted.message };
    });
    if (!result.ok)
      return await failWith(result.stage as Stage, result.message);
    rememberPush(ctx, job, result.commit);
    log(`${tag}: pushed revert ${short(result.commit)}`);

    stage = "deploy";
    const deployment = await deploy(ctx, job, result.commit);
    await openseo.recordAttempt({
      ...base,
      status: "deploying",
      mergeCommit: result.commit,
      coolifyDeploymentUuid: deployment.uuid,
    });
    const deployFailure = await deployment.wait();
    if (deployFailure) return await failWith("deploy", deployFailure);

    stage = "verify";
    const live = item.targetUrl
      ? await verifyLive(item.targetUrl, null, LIVE_WAIT_MS)
      : null;
    const note = live
      ? `After rollback the target page returns status ${live.statusCode ?? "none"}.`
      : "No target URL to check.";
    await openseo.recordAttempt({
      ...base,
      status: "rolled_back",
      mergeCommit: result.commit,
      liveStatusCode: live?.statusCode ?? undefined,
      liveCheck: {
        noindex: live?.noindex ?? false,
        canonical: live?.canonical ?? null,
        notes: note,
      },
    });
    ctx.counts.rolledBack += 1;
    log(`${tag}: rolled back. ${note}`);
  } catch (error) {
    await failWith(stage, errorMessage(error)).catch((recordError) =>
      log(`${tag}: could not record failure: ${errorMessage(recordError)}`),
    );
  }
}

/** Everything for one site. The caller holds the site lock. */
export async function processSite(ctx: RunContext, job: SiteJob) {
  const cloneDir = path.join(ctx.sitesDir, job.repoName);
  git(cloneDir, ["fetch", "origin"]);
  await detectChanges(ctx, job, cloneDir);

  const queue = await ctx.openseo.listPublishQueue(job.projectId);
  const handled = new Set(
    ctx.state.repos[job.repoName]?.handledApprovals ?? [],
  );
  const plan = planRun(queue, handled);
  for (const skipped of plan.skipped) {
    ctx.counts.skipped += 1;
    ctx.log(`${job.label}: skip asset ${skipped.assetId}: ${skipped.reason}`);
  }
  ctx.log(
    `${job.label}: ${plan.rollbacks.length} rollback(s), ${plan.publish.length} publish(es) to do`,
  );

  for (const item of plan.rollbacks) {
    if (ctx.dryRun)
      ctx.log(
        `${job.label}: [dry-run] would revert ${item.mergeCommit ?? "(none)"} for asset ${item.assetId}`,
      );
    else await rollbackItem(ctx, job, item);
  }
  for (const item of plan.publish) {
    if (ctx.dryRun)
      ctx.log(
        `${job.label}: [dry-run] would publish asset ${item.assetId} v${item.version} from ${item.taskBranch} to ${item.targetUrl ?? "(no url)"}`,
      );
    else await publishItem(ctx, job, item);
  }
}
