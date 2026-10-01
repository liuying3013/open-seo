// Deterministic ranking for the cross-project task pool (specs/0013 section
// 4.3). Every number here produces a sentence: the spec's requirement is that
// a priority is explainable, not that it is precise.

export const TASK_POOL_RULE_VERSION = "task-pool-v1";

/**
 * Weights over 0..100 subscores. Business value dominates because content-ops
 * already folded commercial reality into it (supply readiness, margin, market
 * priority); the rest of this model is about what a task COSTS and how sure we
 * are it is worth doing at all.
 */
const WEIGHTS = {
  businessValue: 0.5,
  contentGap: 0.2,
  evidenceReadiness: 0.2,
  cheapness: 0.1,
} as const;

type CoverageVerdictInput = "new" | "update" | "optimize" | "merge" | "skip";

/**
 * How much value there is in acting, given what we already publish. Optimize
 * scores highest: a page with the content but no internal links is the largest
 * gain per unit of work in the whole model. Merge scores zero because it is a
 * human decision, not a production task.
 */
const CONTENT_GAP_SCORE: Record<CoverageVerdictInput, number> = {
  optimize: 100,
  update: 85,
  new: 70,
  skip: 0,
  merge: 0,
};

const GAP_REASON: Record<CoverageVerdictInput, string> = {
  optimize: "we already rank-worthy content here that almost nothing links to",
  update: "we have a page on this that is thin or unindexable",
  new: "nothing of ours covers this topic",
  skip: "an adequate page of ours already covers it",
  merge: "two of our pages compete here and consolidation is a human call",
};

export type TaskPoolInputs = {
  projectName: string;
  clusterName: string;
  /** content-ops business value, 0..100. Null when the cluster is unscored. */
  businessValue: number | null;
  coverageVerdict: CoverageVerdictInput;
  /** Do we already hold the SERP evidence this task needs? */
  hasSerpSnapshots: boolean;
  /** Have the ranking pages been read? */
  hasReadPages: boolean;
  /** SERP fetches this task still has to buy. */
  pendingSerpFetches: number;
};

type TaskPoolScore = {
  score: number;
  subscores: Record<string, number>;
  /** Why this task sits where it does, in words. */
  reason: string;
};

export function scoreTask(input: TaskPoolInputs): TaskPoolScore {
  const businessValue = input.businessValue ?? 0;
  const contentGap = CONTENT_GAP_SCORE[input.coverageVerdict];
  // Evidence we already hold is evidence we do not re-buy.
  const evidenceReadiness =
    (input.hasSerpSnapshots ? 50 : 0) + (input.hasReadPages ? 50 : 0);
  // Five pending fetches is the practical worst case for one cluster.
  const cheapness = Math.max(0, 100 - input.pendingSerpFetches * 20);

  const subscores = {
    businessValue,
    contentGap,
    evidenceReadiness,
    cheapness,
  };
  const score =
    Math.round(
      (businessValue * WEIGHTS.businessValue +
        contentGap * WEIGHTS.contentGap +
        evidenceReadiness * WEIGHTS.evidenceReadiness +
        cheapness * WEIGHTS.cheapness) *
        10,
    ) / 10;

  const evidenceWords = input.hasReadPages
    ? "the ranking pages are already read"
    : input.hasSerpSnapshots
      ? "the SERPs are stored but no page bodies are read yet"
      : "no SERP evidence is stored yet";

  const reason =
    input.businessValue === null
      ? `${input.clusterName} (${input.projectName}) is unscored, so its business value counts as zero; ` +
        `${GAP_REASON[input.coverageVerdict]}, and ${evidenceWords}.`
      : `${input.clusterName} (${input.projectName}) scores ${businessValue} on business value; ` +
        `${GAP_REASON[input.coverageVerdict]}, and ${evidenceWords}.`;

  return { score, subscores, reason };
}

/** Verdicts that produce no production task at all. */
export function isActionable(verdict: CoverageVerdictInput): boolean {
  return verdict !== "skip";
}
