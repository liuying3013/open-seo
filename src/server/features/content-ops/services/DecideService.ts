import { z } from "zod";
import { ContentOpsError } from "../contentOpsErrors";
import {
  RULE_VERSION,
  USER_JOBS,
  type IntentAxis,
  type ThirdPartyPlatform,
} from "../rules/scoringRules";
import {
  computePlatformPlan,
  decideMoneySitePageType,
  type PlatformPlanEntry,
} from "../rules/computeScores";
import { ClustersRepository } from "../repositories/ClustersRepository";
import { DecisionLogRepository } from "../repositories/DecisionLogRepository";
import { DecisionsRepository } from "../repositories/DecisionsRepository";
import { getProjectContext } from "@/server/features/project-context/services/ProjectContextService";
import {
  ENTITY_TAXONOMY_SLUG,
  classifyEntityRelation,
  parseEntityTaxonomy,
} from "../rules/entityRules";

// decide_deployment is fully DETERMINISTIC: page type and platform verdicts
// come from stored scores + versioned rules. The LLM never decides here — it
// only ever contributed evidence upstream (content types, disambiguation).

const intentVectorSchema = z.record(z.string(), z.number());
const scoresSchema = z.record(z.string(), z.number());

async function decideDeployment(input: {
  projectId: string;
  clusterId: string;
  brandNaturalness?: Partial<Record<ThirdPartyPlatform, number>>;
  evidenceReadiness?: number;
}) {
  const cluster = await ClustersRepository.getById(
    input.projectId,
    input.clusterId,
  );
  if (!cluster) {
    throw new ContentOpsError("CLUSTER_NOT_FOUND", "Cluster not found.");
  }
  if (cluster.status !== "scored") {
    throw new ContentOpsError(
      "SERP_NOT_READY",
      `Cluster must be scored before deciding (status: ${cluster.status}).`,
    );
  }
  if (cluster.entityCategory === "AMBIGUOUS") {
    throw new ContentOpsError(
      "DISAMBIGUATION_REQUIRED",
      "Entity is AMBIGUOUS — run analyze_cluster first.",
    );
  }
  const intentVector = intentVectorSchema.parse(
    JSON.parse(cluster.intentVector ?? "null"),
  );
  const formatScores = scoresSchema.parse(
    JSON.parse(cluster.serpFormatScores ?? "null"),
  );
  const platformAcceptance = scoresSchema.parse(
    JSON.parse(cluster.platformAcceptance ?? "null"),
  );
  if (cluster.businessValueScore === null) {
    throw new ContentOpsError(
      "SERP_NOT_READY",
      "Business value score missing — run score_cluster first.",
    );
  }
  const userJob = USER_JOBS.find((job) => job === cluster.userJob);
  if (!userJob) {
    throw new ContentOpsError(
      "SERP_NOT_READY",
      `Cluster has no valid user_job (${cluster.userJob ?? "null"}); set one when saving clusters.`,
    );
  }

  // What the category is to the business decides how far the cluster goes:
  // TARGET deploys as usual; ADJACENT deploys as the honest alternative
  // (searchers want brick veneer, the business sells what replaces it);
  // anything else is off-target and never deployed.
  const context = await getProjectContext(input.projectId);
  const taxonomyText =
    context.customSections.find((s) => s.slug === ENTITY_TAXONOMY_SLUG)
      ?.content ?? null;
  const taxonomy = parseEntityTaxonomy(taxonomyText);
  const entityRelation = classifyEntityRelation({
    taxonomy: taxonomyText,
    entityCategory: cluster.entityCategory,
  });

  const fullPlan = computePlatformPlan({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated numeric record
    platformAcceptance: platformAcceptance as Record<
      ThirdPartyPlatform,
      number
    >,
    userJob,
    brandNaturalness: input.brandNaturalness,
    evidenceReadiness: input.evidenceReadiness,
  });
  let pageType: string;
  let pageTypeReason: string;
  let platformPlan: PlatformPlanEntry[];
  if (entityRelation === "off_target") {
    pageType = "none";
    pageTypeReason = `Entity category "${cluster.entityCategory}" is off-target: not sold (${taxonomy.target.join(", ")}) and not declared ADJACENT (${taxonomy.adjacent.join(", ") || "none"}).`;
    platformPlan = fullPlan.map((entry) => ({
      ...entry,
      verdict: "SKIP" as const,
    }));
  } else {
    const pageDecision = decideMoneySitePageType({
      formatScores,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated numeric record
      intentVector: intentVector as Record<IntentAxis, number>,
    });
    pageType = pageDecision.pageType;
    pageTypeReason = pageDecision.reason;
    platformPlan = fullPlan;
    if (entityRelation === "adjacent") {
      const category = cluster.entityCategory;
      const sold = taxonomy.target.join(" / ");
      // A product or category page for something the business does not stock
      // cannot exist; the SERP's buyer intent goes to a comparison page that
      // argues the alternative instead.
      const cannotStock = pageType === "product" || pageType === "category";
      if (cannotStock) pageType = "comparison";
      pageTypeReason =
        `Adjacent category "${category}": searchers want ${category}, which the business does not sell — write as the honest alternative (${sold}), never as a ${category} supplier. ` +
        (cannotStock
          ? `Google ranks ${pageDecision.pageType} pages here, which cannot exist for it, so a comparison page carries that buyer intent instead.`
          : pageDecision.reason);
    }
  }

  const reasonSummary = [
    `Money site: ${pageType} — ${pageTypeReason}`,
    ...platformPlan
      .filter((entry) => entry.verdict === "DEPLOY" || entry.verdict === "TEST")
      .map(
        (entry) =>
          `${entry.platform}: ${entry.verdict} (${entry.score}; acceptance ${Math.round(entry.subscores.serpAcceptance)}, fit ${Math.round(entry.subscores.intentFit)})`,
      ),
  ].join(" | ");

  const decisionId = await DecisionsRepository.insert({
    projectId: input.projectId,
    clusterId: input.clusterId,
    moneySitePageType: pageType,
    platformPlan: JSON.stringify(platformPlan),
    reasonSummary,
    decidedBy: "agent",
  });
  await DecisionsRepository.supersedeOpenProposals(input.clusterId, decisionId);
  // The row starts superseded; activation happens only after older proposals
  // close. A partial unique index rejects a concurrent second activation.
  await DecisionsRepository.update(decisionId, {
    status: "proposed",
    supersededById: null,
  });

  await DecisionLogRepository.append({
    projectId: input.projectId,
    clusterId: input.clusterId,
    decisionType: "platform_plan",
    inputSnapshot: JSON.stringify({
      intentVector,
      formatScores,
      platformAcceptance,
      businessValueScore: cluster.businessValueScore,
      entityCategory: cluster.entityCategory,
      userJob,
      entityRelation,
      targetCategories: taxonomy.target,
      adjacentCategories: taxonomy.adjacent,
      agentInputs: {
        brandNaturalness: input.brandNaturalness ?? null,
        evidenceReadiness: input.evidenceReadiness ?? null,
      },
    }),
    decision: JSON.stringify({ decisionId, pageType, platformPlan }),
    reasonSummary,
    ruleVersion: RULE_VERSION,
    createdBy: "agent",
  });

  return {
    decisionId,
    entityRelation,
    pageType,
    pageTypeReason,
    platformPlan,
    reasonSummary,
  };
}

export const DecideService = {
  decideDeployment,
};
