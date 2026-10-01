import { ContentOpsError } from "../contentOpsErrors";
import { RULE_VERSION } from "../rules/scoringRules";
import { normalizeKeyword } from "@/server/lib/normalizeKeyword";
import {
  GENERATE_BRIEF_PROMPT_VERSION,
  GENERATE_BRIEF_SYSTEM,
  briefOutputSchema,
  buildBriefPrompt,
} from "../prompts/generateBrief";
import { evidencePackContentSchema } from "../prompts/evidencePack";
import {
  assertAssetTransition,
  assertClusterTransition,
} from "../stateMachine";
import { AssetsRepository } from "../repositories/AssetsRepository";
import { ClustersRepository } from "../repositories/ClustersRepository";
import { DecisionLogRepository } from "../repositories/DecisionLogRepository";
import { EvidencePacksRepository } from "../repositories/EvidencePacksRepository";
import { getProjectContext } from "@/server/features/project-context/services/ProjectContextService";
import { BudgetService } from "./BudgetService";
import { runStructuredLlm } from "./llm";

// Briefs are generated per asset from the cluster's APPROVED evidence pack.
// Angle uniqueness across sibling platforms is enforced here (spec §22-23:
// platforms must never share one piece of content or one angle).

async function generateBrief(input: { projectId: string; assetId: string }) {
  const asset = await AssetsRepository.getById(input.projectId, input.assetId);
  if (!asset) {
    throw new ContentOpsError("ASSET_NOT_FOUND", "Asset not found.");
  }
  assertAssetTransition(asset.status, "brief_ready");

  const pack = await EvidencePacksRepository.getLatestForCluster(
    asset.clusterId,
  );
  if (!pack || pack.status !== "approved") {
    throw new ContentOpsError(
      "EVIDENCE_PACK_NOT_FOUND",
      pack
        ? "Latest evidence pack is a draft — approve it before generating briefs."
        : "No evidence pack for this cluster — run build_evidence_pack first.",
    );
  }
  const packContent = evidencePackContentSchema.parse(JSON.parse(pack.content));

  const [cluster, siblings, context] = await Promise.all([
    ClustersRepository.getById(input.projectId, asset.clusterId),
    AssetsRepository.listByCluster(asset.clusterId),
    getProjectContext(input.projectId),
  ]);
  if (!cluster) {
    throw new ContentOpsError("CLUSTER_NOT_FOUND", "Cluster not found.");
  }
  const siblingAngles = siblings
    .filter((s) => s.id !== asset.id && s.angle)
    .map((s) => ({ platform: s.platform, angle: s.angle! }));

  await BudgetService.consume(input.projectId, "briefsGenerated");
  const { object, model } = await runStructuredLlm({
    projectId: input.projectId,
    schema: briefOutputSchema,
    system: GENERATE_BRIEF_SYSTEM,
    prompt: buildBriefPrompt({
      platform: asset.platform,
      assetType: asset.assetType,
      brandMentionMode: asset.brandMentionMode,
      clusterName: cluster.name,
      userJob: cluster.userJob,
      pack: packContent,
      siblingAngles,
      writingPreferences:
        context.sections.find((s) => s.key === "writing_preferences")
          ?.content ?? null,
    }),
  });

  // Angle-duplication guard: identical normalized angles are rejected outright.
  const normalizedAngle = normalizeKeyword(object.angle);
  const duplicate = siblingAngles.find(
    (sibling) => normalizeKeyword(sibling.angle) === normalizedAngle,
  );
  if (duplicate) {
    throw new ContentOpsError(
      "LLM_OUTPUT_INVALID",
      `Generated angle duplicates the ${duplicate.platform} asset's angle — re-run generate_brief.`,
      { angle: object.angle },
    );
  }

  const saved = await AssetsRepository.setBriefReady(
    input.projectId,
    input.assetId,
    asset.status,
    {
      angle: object.angle,
      title: object.title,
      brief: object.brief,
    },
  );
  if (!saved) {
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      "Asset changed while its brief was being generated; refresh and retry.",
    );
  }

  // When every sibling has its brief, the cluster itself is brief-ready.
  const after = await AssetsRepository.listByCluster(asset.clusterId);
  const allReady = after.every(
    (sibling) =>
      sibling.status === "brief_ready" || sibling.status === "rejected",
  );
  if (allReady && cluster.status === "decided") {
    assertClusterTransition(cluster.status, "brief_ready");
    await ClustersRepository.transitionStatus(
      input.projectId,
      asset.clusterId,
      "decided",
      "brief_ready",
    );
  }

  await DecisionLogRepository.append({
    projectId: input.projectId,
    clusterId: asset.clusterId,
    decisionType: "brief",
    inputSnapshot: JSON.stringify({
      stage: "brief",
      assetId: asset.id,
      platform: asset.platform,
      packId: pack.id,
      packVersion: pack.version,
      siblingAngles,
    }),
    decision: JSON.stringify({
      assetId: asset.id,
      angle: object.angle,
      title: object.title,
    }),
    reasonSummary: `Brief for ${asset.platform}: ${object.angle}`,
    model,
    promptVersion: GENERATE_BRIEF_PROMPT_VERSION,
    ruleVersion: RULE_VERSION,
    createdBy: "agent",
  });

  return {
    assetId: asset.id,
    platform: asset.platform,
    angle: object.angle,
    title: object.title,
    brief: object.brief,
    clusterBriefReady: allReady,
  };
}

export const BriefService = {
  generateBrief,
};
