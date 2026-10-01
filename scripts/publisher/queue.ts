// Which queue entries the publisher may act on in this run.

import type { PublishItem, PublishQueue, RollbackItem } from "./openseo-client";

export type RunPlan = {
  rollbacks: RollbackItem[];
  publish: PublishItem[];
  skipped: Array<{ assetId: string; reason: string }>;
};

/**
 * - An entry that already has an in-flight attempt is someone else's (or a
 *   crashed run's) and is left alone.
 * - An entry whose approval already failed is not retried automatically; a
 *   person has to re-approve or deal with it.
 * - `handledApprovals` are approvals this publisher already pushed for. A
 *   publish that ended "unverified" leaves the work order in the queue, but the
 *   commit is already on the production branch, so it must not be pushed again.
 * - A work order with a rollback in this run is not published in the same run.
 */
export function planRun(
  queue: PublishQueue,
  handledApprovals: ReadonlySet<string>,
): RunPlan {
  const skipped: RunPlan["skipped"] = [];
  const rollbackAssets = new Set(queue.rollbacks.map((item) => item.assetId));
  const publish = queue.publish.filter((item) => {
    const reason = skipReason(item, handledApprovals, rollbackAssets);
    if (reason) skipped.push({ assetId: item.assetId, reason });
    return !reason;
  });
  return { rollbacks: queue.rollbacks, publish, skipped };
}

function skipReason(
  item: PublishItem,
  handledApprovals: ReadonlySet<string>,
  rollbackAssets: ReadonlySet<string>,
): string | null {
  if (item.activeAttempt) {
    return `attempt ${item.activeAttempt.id} is ${item.activeAttempt.status}`;
  }
  if (item.failedAttempts > 0) return "approval already has a failed attempt";
  if (handledApprovals.has(item.approvalId)) {
    return "already pushed by this publisher (awaiting a decision)";
  }
  if (rollbackAssets.has(item.assetId)) return "rollback requested";
  return null;
}
