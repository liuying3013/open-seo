import { ContentOpsError } from "../contentOpsErrors";
import { RULE_VERSION } from "../rules/scoringRules";
import {
  computeBusinessValue,
  type BusinessValueAgentInputs,
} from "../rules/computeScores";
import { assertClusterTransition } from "../stateMachine";
import { ClustersRepository } from "../repositories/ClustersRepository";
import { DecisionLogRepository } from "../repositories/DecisionLogRepository";
import { OffersRepository } from "../repositories/OffersRepository";

// Business-value scoring: the agent supplies the judgment subscores after
// reading project context; this service does only the versioned arithmetic,
// so every score is reproducible from its log row.

/**
 * Pre-SERP triage: records whether the cluster earns a (paid) SERP fetch.
 * businessFit is the agent's 0..100 judgment from keyword data + offers alone.
 */
async function preScore(input: {
  projectId: string;
  clusterId: string;
  businessFit: number;
  reason: string;
  createdBy: "agent" | "user";
}) {
  const cluster = await ClustersRepository.getById(
    input.projectId,
    input.clusterId,
  );
  if (!cluster) {
    throw new ContentOpsError("CLUSTER_NOT_FOUND", "Cluster not found.");
  }
  assertClusterTransition(cluster.status, "pre_scored");
  const transitioned = await ClustersRepository.transitionStatus(
    input.projectId,
    input.clusterId,
    cluster.status,
    "pre_scored",
  );
  if (!transitioned) {
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      "Cluster changed while it was being pre-scored; refresh and retry.",
    );
  }
  await DecisionLogRepository.append({
    projectId: input.projectId,
    clusterId: input.clusterId,
    decisionType: "pre_score",
    inputSnapshot: JSON.stringify({ businessFit: input.businessFit }),
    decision: JSON.stringify({
      proceedToSerp: input.businessFit >= 40,
      businessFit: input.businessFit,
    }),
    reasonSummary: input.reason,
    ruleVersion: RULE_VERSION,
    createdBy: input.createdBy,
  });
  return { proceedToSerp: input.businessFit >= 40 };
}

/** Full business-value score; requires an AMBIGUOUS-free entity. */
async function scoreBusinessValue(input: {
  projectId: string;
  clusterId: string;
  agent: BusinessValueAgentInputs;
  /** Link (or re-link) the offer this cluster serves before scoring. */
  offerId?: string;
  createdBy: "agent" | "user";
}) {
  const cluster = await ClustersRepository.getById(
    input.projectId,
    input.clusterId,
  );
  if (!cluster) {
    throw new ContentOpsError("CLUSTER_NOT_FOUND", "Cluster not found.");
  }
  if (cluster.entityCategory === "AMBIGUOUS") {
    throw new ContentOpsError(
      "DISAMBIGUATION_REQUIRED",
      "Entity is AMBIGUOUS — fetch SERPs and run analyze_cluster before scoring.",
    );
  }
  if (cluster.status !== "serp_ready" && cluster.status !== "scored") {
    assertClusterTransition(cluster.status, "scored");
  }

  // Clusters saved without an offer score 0 on supplier/margin/priority, so
  // scoring is where the link gets set: the agent has read the offers by now.
  const offerId = input.offerId ?? cluster.offerId;
  const offer = offerId
    ? await OffersRepository.getById(input.projectId, offerId)
    : null;
  if (input.offerId && !offer) {
    throw new ContentOpsError("OFFER_NOT_FOUND", "Offer not found.");
  }
  const keywords = await ClustersRepository.getKeywords(input.clusterId);
  const monthlyVolume = keywords.reduce(
    (sum, keyword) => sum + (keyword.searchVolume ?? 0),
    0,
  );

  const { score, breakdown } = computeBusinessValue({
    offer: offer
      ? {
          marginTier: offer.marginTier,
          readiness: offer.readiness,
          marketPriority: offer.marketPriority,
        }
      : null,
    agent: input.agent,
    monthlyVolume,
  });

  await ClustersRepository.updateScores(input.clusterId, {
    offerId: offer?.id ?? null,
    businessValueScore: score,
    businessValueBreakdown: JSON.stringify({
      ...breakdown,
      agentInputs: input.agent,
      offerId: offer?.id ?? null,
      monthlyVolume,
    }),
    ruleVersion: RULE_VERSION,
  });
  if (cluster.status === "serp_ready") {
    await ClustersRepository.transitionStatus(
      input.projectId,
      input.clusterId,
      "serp_ready",
      "scored",
    );
  }

  await DecisionLogRepository.append({
    projectId: input.projectId,
    clusterId: input.clusterId,
    decisionType: "scoring",
    inputSnapshot: JSON.stringify({
      stage: "business_value",
      offer: offer
        ? {
            id: offer.id,
            marginTier: offer.marginTier,
            readiness: offer.readiness,
            marketPriority: offer.marketPriority,
          }
        : null,
      agentInputs: input.agent,
      monthlyVolume,
    }),
    decision: JSON.stringify({ businessValueScore: score, breakdown }),
    reasonSummary: `Business value ${score}/100 (offer ${offer ? offer.name : "missing"}).`,
    ruleVersion: RULE_VERSION,
    createdBy: input.createdBy,
  });

  return { score, breakdown };
}

export const ScoreService = {
  preScore,
  scoreBusinessValue,
};
