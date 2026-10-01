import { ContentOpsError } from "./contentOpsErrors";

// The pipeline's two state machines. Services call assert*Transition before
// writing a status so an out-of-order tool call (agent-driven loops make those
// likely) fails loudly instead of corrupting pipeline state.

export const CLUSTER_STATUSES = [
  "new",
  "pre_scored",
  "serp_pending",
  "serp_ready",
  "scored",
  "decided",
  "brief_ready",
  "on_hold",
  "archived",
] as const;
export type ClusterStatus = (typeof CLUSTER_STATUSES)[number];

const CLUSTER_TRANSITIONS: Record<ClusterStatus, readonly ClusterStatus[]> = {
  new: ["pre_scored", "on_hold", "archived"],
  pre_scored: ["serp_pending", "on_hold", "archived"],
  // serp_pending -> pre_scored is the fetch-failed reset path.
  serp_pending: ["serp_ready", "pre_scored", "on_hold", "archived"],
  serp_ready: ["scored", "serp_pending", "on_hold", "archived"],
  // scored -> serp_pending supports refetch-then-rescore.
  scored: ["decided", "serp_pending", "on_hold", "archived"],
  // decided -> scored reopens the cluster when a decision is superseded.
  decided: ["brief_ready", "scored", "on_hold", "archived"],
  brief_ready: ["decided", "on_hold", "archived"],
  // on_hold resumes anywhere mid-pipeline (the service knows the real stage
  // from which columns are populated); archived is terminal.
  on_hold: [
    "new",
    "pre_scored",
    "serp_pending",
    "serp_ready",
    "scored",
    "decided",
    "brief_ready",
    "archived",
  ],
  archived: [],
};

export const ASSET_STATUSES = [
  "planned",
  "brief_ready",
  "drafted",
  "qa_review",
  "ready_to_publish",
  "published",
  "indexed",
  "ranking",
  "optimize",
  "refresh",
  "retired",
  "rejected",
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

// MVP only exercises planned/brief_ready/rejected; the rest are pre-declared
// so phase 2 extends data, not the machine.
const ASSET_TRANSITIONS: Record<AssetStatus, readonly AssetStatus[]> = {
  // A page work order can receive a submitted content version from planned or
  // brief_ready (qa_review) without passing through the LLM draft step.
  planned: ["brief_ready", "qa_review", "rejected"],
  // brief_ready -> planned is the redo-the-brief path.
  brief_ready: ["planned", "drafted", "qa_review", "rejected"],
  drafted: ["qa_review", "brief_ready", "rejected"],
  qa_review: ["ready_to_publish", "drafted", "rejected"],
  // ready_to_publish -> qa_review: approval revoked or fingerprint mismatch.
  // ready_to_publish -> drafted: rejected after approval.
  ready_to_publish: ["published", "qa_review", "drafted", "rejected"],
  // published-family -> drafted: a verified rollback sends the work back.
  published: ["indexed", "retired", "drafted"],
  indexed: ["ranking", "optimize", "retired", "drafted"],
  ranking: ["optimize", "refresh", "retired", "drafted"],
  optimize: ["ranking", "refresh", "retired", "drafted"],
  refresh: ["ranking", "retired", "drafted"],
  retired: [],
  rejected: ["planned"],
};

function assertTransition<S extends string>(
  kind: "cluster" | "asset",
  transitions: Record<S, readonly S[]>,
  from: S,
  to: S,
): void {
  if (!transitions[from]?.includes(to)) {
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      `Invalid ${kind} status transition: ${from} -> ${to}`,
      { kind, from, to },
    );
  }
}

export function assertClusterTransition(
  from: ClusterStatus,
  to: ClusterStatus,
): void {
  assertTransition("cluster", CLUSTER_TRANSITIONS, from, to);
}

export function assertAssetTransition(
  from: AssetStatus,
  to: AssetStatus,
): void {
  assertTransition("asset", ASSET_TRANSITIONS, from, to);
}
