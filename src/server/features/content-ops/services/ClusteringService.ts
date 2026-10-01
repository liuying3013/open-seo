import { ContentOpsError } from "../contentOpsErrors";
import { normalizeKeyword } from "@/server/lib/normalizeKeyword";
import {
  MAX_REPRESENTATIVE_KEYWORDS,
  RULE_VERSION,
} from "../rules/scoringRules";
import {
  PROPOSE_CLUSTERS_PROMPT_VERSION,
  PROPOSE_CLUSTERS_SYSTEM,
  buildProposeClustersPrompt,
  proposedClusterSchema,
  type ProposedClusters,
} from "../prompts/proposeClusters";
import {
  ClustersRepository,
  type NewClusterInput,
} from "../repositories/ClustersRepository";
import { DecisionLogRepository } from "../repositories/DecisionLogRepository";
import { runStructuredLlm } from "./llm";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { getProjectContext } from "@/server/features/project-context/services/ProjectContextService";

// Clustering is two-phase by design: propose() is read-only (the agent and
// user review/edit the proposal in chat), save() persists the confirmed shape
// and writes the decision log. The agent never writes clusters directly.

const ENTITY_TAXONOMY_SECTION = "custom:entity-taxonomy";

async function loadPromptContext(projectId: string) {
  const [project, context] = await Promise.all([
    ProjectRepository.getProjectById(projectId),
    getProjectContext(projectId),
  ]);
  const businessOverview =
    context.sections.find((s) => s.key === "business_overview")?.content ?? "";
  const positioning =
    context.sections.find((s) => s.key === "positioning")?.content ?? "";
  const entityTaxonomy =
    context.customSections.find(
      (s) => `custom:${s.slug}` === ENTITY_TAXONOMY_SECTION,
    )?.content ?? null;
  return {
    projectName: project?.name ?? "Unknown project",
    projectDomain: project?.domain ?? null,
    businessContext: [businessOverview, positioning]
      .filter(Boolean)
      .join("\n\n"),
    entityTaxonomy,
  };
}

/**
 * Read-only clustering proposal over the project's unclustered candidate
 * keywords (optionally restricted to candidateKeywordIds). Returns the
 * proposal plus enough metadata for save() to be fully attributable.
 */
async function propose(input: {
  projectId: string;
  candidateKeywordIds?: string[];
}): Promise<{
  proposal: ProposedClusters;
  model: string;
  promptVersion: string;
  candidateCount: number;
}> {
  const candidates = await ClustersRepository.getUnclusteredCandidateKeywords(
    input.projectId,
    input.candidateKeywordIds,
  );
  if (candidates.length === 0) {
    throw new ContentOpsError(
      "KEYWORDS_NOT_FOUND",
      "No unclustered candidate keywords to propose clusters for.",
    );
  }
  const promptContext = await loadPromptContext(input.projectId);
  const { object, model } = await runStructuredLlm({
    projectId: input.projectId,
    schema: proposedClusterSchema,
    system: PROPOSE_CLUSTERS_SYSTEM,
    prompt: buildProposeClustersPrompt({
      ...promptContext,
      keywords: candidates.map((k) => ({
        keyword: k.keyword,
        searchVolume: k.searchVolume,
        intent: k.intent,
        source: k.source,
      })),
    }),
  });
  return {
    proposal: object,
    model,
    promptVersion: PROPOSE_CLUSTERS_PROMPT_VERSION,
    candidateCount: candidates.length,
  };
}

type SaveClusterInput = {
  name: string;
  offerId?: string | null;
  primaryEntity?: string | null;
  entityCategory?: string | null;
  userJob?: string | null;
  keywords: string[];
  representatives: string[];
};

/**
 * Persist confirmed clusters. Keywords are matched against candidate keywords
 * by normalized text; unknown or already-clustered keywords fail the whole
 * call (nothing partial is written).
 */
async function save(input: {
  projectId: string;
  clusters: SaveClusterInput[];
  createdBy: "agent" | "user";
  model?: string | null;
  promptVersion?: string | null;
}) {
  const candidates = await ClustersRepository.getUnclusteredCandidateKeywords(
    input.projectId,
  );
  const byNormalized = new Map(
    candidates.map((k) => [normalizeKeyword(k.keyword), k]),
  );

  const unknown: string[] = [];
  const prepared: NewClusterInput[] = input.clusters.map((cluster) => {
    const resolve = (keyword: string) =>
      byNormalized.get(normalizeKeyword(keyword));
    const candidateKeywordIds: string[] = [];
    for (const keyword of cluster.keywords) {
      const match = resolve(keyword);
      if (!match) unknown.push(keyword);
      else candidateKeywordIds.push(match.id);
    }
    const representativeIds = cluster.representatives
      .map((keyword) => resolve(keyword)?.id)
      .filter(
        (id): id is string => Boolean(id) && candidateKeywordIds.includes(id!),
      )
      .slice(0, MAX_REPRESENTATIVE_KEYWORDS);
    return {
      name: cluster.name,
      offerId: cluster.offerId ?? null,
      primaryEntity: cluster.primaryEntity ?? null,
      entityCategory: cluster.entityCategory ?? null,
      userJob: cluster.userJob ?? null,
      candidateKeywordIds,
      // Fall back to the first keyword so every cluster has >=1 representative.
      representativeCandidateKeywordIds:
        representativeIds.length > 0
          ? representativeIds
          : candidateKeywordIds.slice(0, 1),
    };
  });

  if (unknown.length > 0) {
    throw new ContentOpsError(
      "KEYWORDS_NOT_FOUND",
      `These keywords are not unclustered candidate keywords of the project: ${unknown.join(", ")}. ` +
        `Save them first (save_candidate_keywords) or remove them from the clusters.`,
      { unknown },
    );
  }
  const claimed = prepared.flatMap((c) => c.candidateKeywordIds);
  if (new Set(claimed).size !== claimed.length) {
    throw new ContentOpsError(
      "KEYWORDS_ALREADY_CLUSTERED",
      "The same keyword appears in more than one submitted cluster.",
    );
  }

  const clusterIds = await ClustersRepository.insertClusters(
    input.projectId,
    prepared,
  );
  await DecisionLogRepository.append({
    projectId: input.projectId,
    decisionType: "clustering",
    inputSnapshot: JSON.stringify({
      clusters: input.clusters.map((c) => ({
        name: c.name,
        keywords: c.keywords,
        representatives: c.representatives,
        entityCategory: c.entityCategory ?? null,
        userJob: c.userJob ?? null,
      })),
    }),
    decision: JSON.stringify({ clusterIds }),
    reasonSummary: `Saved ${clusterIds.length} clusters covering ${claimed.length} keywords.`,
    model: input.model ?? null,
    promptVersion: input.promptVersion ?? null,
    ruleVersion: RULE_VERSION,
    createdBy: input.createdBy,
  });
  return { clusterIds };
}

export const ClusteringService = {
  propose,
  save,
};
