import { ContentOpsError } from "../contentOpsErrors";
import { RULE_VERSION } from "../rules/scoringRules";
import { computeSerpScores, deriveIntentVector } from "../rules/computeScores";
import {
  ANALYZE_CLUSTER_PROMPT_VERSION,
  ANALYZE_CLUSTER_SYSTEM,
  analyzeClusterSchema,
  buildAnalyzeClusterPrompt,
} from "../prompts/analyzeCluster";
import { assertClusterTransition } from "../stateMachine";
import { ClustersRepository } from "../repositories/ClustersRepository";
import { DecisionLogRepository } from "../repositories/DecisionLogRepository";
import { SerpRepository } from "../repositories/SerpRepository";
import { getProjectContext } from "@/server/features/project-context/services/ProjectContextService";
import { runStructuredLlm } from "./llm";

// analyze_cluster: the one LLM-assisted pass over stored SERP rows. It fills
// missing content types, resolves AMBIGUOUS entities against SERP reality,
// then computes the deterministic score columns (format shares, platform
// acceptance, intent vector) and logs everything.

const MAX_LLM_CLASSIFY_ROWS = 40;
import { ENTITY_TAXONOMY_SLUG } from "../rules/entityRules";

async function analyzeCluster(input: { projectId: string; clusterId: string }) {
  const cluster = await ClustersRepository.getById(
    input.projectId,
    input.clusterId,
  );
  if (!cluster) {
    throw new ContentOpsError("CLUSTER_NOT_FOUND", "Cluster not found.");
  }
  if (cluster.status !== "serp_ready" && cluster.status !== "scored") {
    // Not a real transition target — fail with the machine's error for clarity.
    assertClusterTransition(cluster.status, "scored");
  }

  const snapshotGroups = await SerpRepository.getLatestForCluster(
    input.clusterId,
  );
  if (snapshotGroups.length === 0) {
    throw new ContentOpsError(
      "SERP_NOT_READY",
      "No stored SERP snapshots for this cluster; run fetch_cluster_serps first.",
    );
  }
  const allResults = snapshotGroups.flatMap((group) => group.results);
  const keywords = snapshotGroups.map((group) => group.snapshot.keyword);

  // LLM pass: classify organic rows the heuristics couldn't, and (when the
  // entity is AMBIGUOUS) judge the dominant sense from the same evidence.
  const needsDisambiguation = cluster.entityCategory === "AMBIGUOUS";
  const unclassified = allResults
    .filter((r) => r.resultType === "organic" && r.contentType === null)
    .slice(0, MAX_LLM_CLASSIFY_ROWS);

  let model: string | null = null;
  if (unclassified.length > 0 || needsDisambiguation) {
    const taxonomy = needsDisambiguation
      ? await loadEntityTaxonomy(input.projectId)
      : null;
    // Without a taxonomy the prompt has no categories to choose between, so it
    // takes its "not asked to disambiguate" branch and correctly returns null —
    // and the check further down then reports that as an LLM failure and asks
    // for a re-run that can never succeed. Fail here instead, before paying for
    // the call, and say what is actually missing.
    if (needsDisambiguation && !taxonomy) {
      throw new ContentOpsError(
        "DISAMBIGUATION_REQUIRED",
        `Cluster "${cluster.name}" is AMBIGUOUS but this project has no entity taxonomy to resolve it against. ` +
          `Add a custom project-context section with slug "${ENTITY_TAXONOMY_SLUG}" listing the categories ` +
          `(prefix what you sell with TARGET:, categories whose buyers you can serve with an alternative with ADJACENT:, ` +
          `leave the rest bare), then re-run analyze_cluster.`,
        { clusterId: cluster.id, missingSection: ENTITY_TAXONOMY_SLUG },
      );
    }
    const { object, model: usedModel } = await runStructuredLlm({
      projectId: input.projectId,
      schema: analyzeClusterSchema,
      system: ANALYZE_CLUSTER_SYSTEM,
      prompt: buildAnalyzeClusterPrompt({
        clusterName: cluster.name,
        primaryEntity: cluster.primaryEntity,
        keywords: [...new Set(keywords)],
        results: (unclassified.length > 0
          ? unclassified
          : allResults.slice(0, MAX_LLM_CLASSIFY_ROWS)
        ).map((r) => ({
          rank: r.rank,
          url: r.url,
          title: r.title,
          description: r.description,
        })),
        disambiguate:
          needsDisambiguation && taxonomy
            ? { taxonomy, currentCategory: "AMBIGUOUS" }
            : null,
      }),
    });
    model = usedModel;

    const byUrl = new Map(unclassified.map((r) => [r.url, r.id]));
    const updates = object.contentTypes.flatMap((entry) => {
      const resultId = byUrl.get(entry.url);
      return resultId ? [{ resultId, contentType: entry.contentType }] : [];
    });
    if (updates.length > 0) {
      await SerpRepository.updateResultContentTypes(updates);
      // Reflect the classification in our in-memory copy before scoring.
      const typeByUrl = new Map(
        object.contentTypes.map((entry) => [entry.url, entry.contentType]),
      );
      for (const result of allResults) {
        if (result.contentType === null) {
          result.contentType = typeByUrl.get(result.url) ?? null;
        }
      }
    }

    if (needsDisambiguation) {
      if (!object.dominantEntitySense) {
        throw new ContentOpsError(
          "DISAMBIGUATION_REQUIRED",
          "The disambiguation pass returned no dominant sense; re-run analyze_cluster.",
        );
      }
      await ClustersRepository.updateScores(input.clusterId, {
        entityCategory: object.dominantEntitySense,
      });
      cluster.entityCategory = object.dominantEntitySense;
      await DecisionLogRepository.append({
        projectId: input.projectId,
        clusterId: input.clusterId,
        decisionType: "entity_disambiguation",
        inputSnapshot: JSON.stringify({
          keywords: [...new Set(keywords)],
          topResults: allResults.slice(0, 10).map((r) => ({
            rank: r.rank,
            url: r.url,
            title: r.title,
          })),
        }),
        decision: JSON.stringify({
          entityCategory: object.dominantEntitySense,
        }),
        reasonSummary: object.disambiguationReason,
        model,
        promptVersion: ANALYZE_CLUSTER_PROMPT_VERSION,
        ruleVersion: RULE_VERSION,
        confidence: object.disambiguationConfidence,
        createdBy: "agent",
      });
    }
  }

  // Deterministic scoring over the (now classified) rows.
  const { formatScores, platformAcceptance } = computeSerpScores(allResults);
  const intentVector = deriveIntentVector(formatScores);
  const scoredAt = new Date().toISOString();
  await ClustersRepository.updateScores(input.clusterId, {
    intentVector: JSON.stringify(intentVector),
    serpFormatScores: JSON.stringify(formatScores),
    platformAcceptance: JSON.stringify(platformAcceptance),
    scoredAt,
    ruleVersion: RULE_VERSION,
  });
  if (cluster.status === "serp_ready") {
    assertClusterTransition(cluster.status, "scored");
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
      stage: "serp_analysis",
      snapshotIds: snapshotGroups.map((g) => g.snapshot.id),
      resultCount: allResults.length,
    }),
    decision: JSON.stringify({
      formatScores,
      platformAcceptance,
      intentVector,
    }),
    reasonSummary: `Analyzed ${allResults.length} SERP rows across ${snapshotGroups.length} snapshots.`,
    model,
    promptVersion: model ? ANALYZE_CLUSTER_PROMPT_VERSION : null,
    ruleVersion: RULE_VERSION,
    createdBy: "agent",
  });

  return {
    entityCategory: cluster.entityCategory,
    formatScores,
    platformAcceptance,
    intentVector,
  };
}

async function loadEntityTaxonomy(projectId: string): Promise<string | null> {
  const context = await getProjectContext(projectId);
  return (
    context.customSections.find((s) => s.slug === ENTITY_TAXONOMY_SLUG)
      ?.content ?? null
  );
}

export const AnalyzeService = {
  analyzeCluster,
};
