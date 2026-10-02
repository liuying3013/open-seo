// Which queue entries the publisher may act on in this run.

import type { PublishItem, PublishQueue, RollbackItem } from "./openseo-client";

export type RunPlan = {
  rollbacks: RollbackItem[];
  publish: PublishItem[];
  // Pushed by this publisher, but the deploy failed afterwards: deploy and
  // verify the pushed commit again, never push a second time.
  redeploy: PublishItem[];
  skipped: Array<{ assetId: string; reason: string }>;
};

// A deploy that keeps failing is broken by the change itself, not by the
// build server; stop retrying after this many failed attempts.
export const MAX_DEPLOY_TRIES = 3;

/**
 * - An entry that already has an in-flight attempt is someone else's (or a
 *   crashed run's) and is left alone.
 * - A work order with a rollback in this run is not published in the same run.
 * - `handledApprovals` are approvals this publisher already pushed for. Their
 *   commit is on the production branch, so they are never pushed again. A
 *   failed attempt after that push is a failed deploy: it is deployed again,
 *   up to MAX_DEPLOY_TRIES failed attempts.
 * - Any other approval with a failed attempt is not retried automatically; a
 *   person has to re-approve or deal with it.
 */
export function planRun(
  queue: PublishQueue,
  handledApprovals: ReadonlySet<string>,
): RunPlan {
  const skipped: RunPlan["skipped"] = [];
  const publish: PublishItem[] = [];
  const redeploy: PublishItem[] = [];
  const rollbackAssets = new Set(queue.rollbacks.map((item) => item.assetId));
  for (const item of queue.publish) {
    const reason = skipReason(item, handledApprovals, rollbackAssets);
    if (reason) skipped.push({ assetId: item.assetId, reason });
    else if (handledApprovals.has(item.approvalId)) redeploy.push(item);
    else publish.push(item);
  }
  return { rollbacks: queue.rollbacks, publish, redeploy, skipped };
}

function skipReason(
  item: PublishItem,
  handledApprovals: ReadonlySet<string>,
  rollbackAssets: ReadonlySet<string>,
): string | null {
  if (item.activeAttempt) {
    return `attempt ${item.activeAttempt.id} is ${item.activeAttempt.status}`;
  }
  if (rollbackAssets.has(item.assetId)) return "rollback requested";
  if (handledApprovals.has(item.approvalId)) {
    if (item.failedAttempts === 0) {
      return "already pushed by this publisher (awaiting a decision)";
    }
    if (item.failedAttempts >= MAX_DEPLOY_TRIES) {
      return `deploy failed ${item.failedAttempts} times; needs a person`;
    }
    return null;
  }
  if (item.failedAttempts > 0) return "approval already has a failed attempt";
  return null;
}
