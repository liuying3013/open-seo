import { ClustersRepository } from "@/server/features/content-ops/repositories/ClustersRepository";
import { AssetsRepository } from "@/server/features/content-ops/repositories/AssetsRepository";
import { EvidencePacksRepository } from "@/server/features/content-ops/repositories/EvidencePacksRepository";
import { runStructuredLlm } from "@/server/features/content-ops/services/llm";
import { ContentFactoryError } from "../contentFactoryErrors";
import { KnowledgeRepository } from "../repositories/KnowledgeRepository";
import { ResearchPagesRepository } from "../repositories/ResearchPagesRepository";
import {
  EXTRACT_KNOWLEDGE_PROMPT_VERSION,
  EXTRACT_KNOWLEDGE_SYSTEM,
  buildExtractKnowledgePrompt,
  knowledgeDeltaSchema,
} from "../prompts/extractKnowledge";
import {
  KNOWLEDGE_RULE_VERSION,
  normalizeStatement,
  recheckAfterFor,
} from "../rules/knowledgeRules";

// specs/0013 section 8.3: after a task finishes, work out what the project now
// knows that it did not before. Extraction reads the research material, the
// evidence pack and the brief — not just the finished article, which is a
// summary of the thinking rather than the thinking.
//
// Everything extracted lands as `candidate`. Nothing becomes usable knowledge
// without passing the approval gate in KnowledgeService.

const MAX_KNOWN_STATEMENTS = 60;
const MAX_PAGES_IN_PROMPT = 8;

async function extractForCluster(input: {
  projectId: string;
  clusterId: string;
}) {
  const cluster = await ClustersRepository.getById(
    input.projectId,
    input.clusterId,
  );
  if (!cluster) {
    throw new ContentFactoryError("CLUSTER_NOT_FOUND", "Cluster not found.");
  }

  const [pages, assets, latestPack, known] = await Promise.all([
    ResearchPagesRepository.getLatestForCluster(input.clusterId),
    AssetsRepository.listByCluster(input.clusterId),
    EvidencePacksRepository.getLatestForCluster(input.clusterId),
    KnowledgeRepository.listByProject({
      projectId: input.projectId,
      limit: MAX_KNOWN_STATEMENTS,
    }),
  ]);

  const readPages = pages.filter((p) => p.fetchStatus === "ok" && p.bodyText);
  const approvedPack = latestPack;
  const brief = assets.find((a) => a.brief)?.brief ?? null;

  if (readPages.length === 0 && !approvedPack && !brief) {
    throw new ContentFactoryError(
      "NO_EXTRACTION_INPUT",
      "Nothing to extract from: this cluster has no read pages, no evidence pack and no brief. " +
        "Run read_ranking_pages and build_evidence_pack first.",
      { clusterId: input.clusterId },
    );
  }

  const { object: delta, model } = await runStructuredLlm({
    projectId: input.projectId,
    schema: knowledgeDeltaSchema,
    system: EXTRACT_KNOWLEDGE_SYSTEM,
    prompt: buildExtractKnowledgePrompt({
      clusterName: cluster.name,
      entity: cluster.primaryEntity,
      rankingPages: readPages.slice(0, MAX_PAGES_IN_PROMPT).map((page) => ({
        url: page.url,
        title: page.title,
        bodyText: page.bodyText ?? "",
      })),
      unreadableUrls: pages
        .filter((p) => p.fetchStatus !== "ok")
        .map((p) => p.url),
      evidencePack: approvedPack?.content ?? null,
      brief,
      knownStatements: known.map((k) => ({
        statement: k.statement,
        claimType: k.claimType,
      })),
    }),
  });

  const now = new Date().toISOString();
  const byNormalized = new Map(known.map((k) => [k.normalizedStatement, k]));
  const pageByUrl = new Map(readPages.map((p) => [p.url, p]));

  // New claims land as candidates. A statement that already exists is counted
  // as support rather than inserted again — the unique index would reject it
  // anyway, and a duplicate is evidence of agreement, not of a new fact.
  let added = 0;
  let duplicates = 0;
  for (const claim of delta.claims) {
    const normalized = normalizeStatement(claim.statement);
    if (byNormalized.has(normalized)) {
      duplicates += 1;
      continue;
    }
    const page = claim.sourceUrl ? pageByUrl.get(claim.sourceUrl) : undefined;
    const id = await KnowledgeRepository.insertCandidate({
      projectId: input.projectId,
      claimType: claim.claimType,
      category: claim.category,
      statement: claim.statement,
      normalizedStatement: normalized,
      entity: claim.entity,
      applicability: claim.applicability,
      numericValue: claim.numericValue,
      numericUnit: claim.numericUnit,
      scope: claim.scope,
      sourceQuality: claim.sourceQuality,
      modelConfidence: claim.confidence,
      recheckAfter: recheckAfterFor(claim.category, now),
      ruleVersion: KNOWLEDGE_RULE_VERSION,
      sources: claim.sourceUrl
        ? [
            {
              researchPageId: page?.id ?? null,
              sourceType: "ranking_page",
              url: claim.sourceUrl,
              excerpt: claim.excerpt,
              locator: null,
              isIndependent: true,
              // Set from our own domain check when the page is one of ours;
              // ranking pages we read are competitors by construction.
              isOwnContent: false,
            },
          ]
        : [],
    });
    if (id) added += 1;
    else duplicates += 1;
  }

  // Conflicts are recorded, never auto-resolved: picking a winner to tidy the
  // output is exactly what section 8.7 forbids.
  let conflictsRecorded = 0;
  for (const conflict of delta.conflicts) {
    const existing = byNormalized.get(
      normalizeStatement(conflict.existingStatement),
    );
    if (!existing) continue;
    await KnowledgeRepository.insertConflict({
      projectId: input.projectId,
      knowledgeId: existing.id,
      conflictingId: existing.id,
      kind: conflict.kind,
      detail: conflict.conflictingFinding,
    });
    await KnowledgeRepository.setStatus({
      projectId: input.projectId,
      id: existing.id,
      status: "needs_review",
      verifiedBy: "model",
    });
    conflictsRecorded += 1;
  }

  const supported = delta.supportedStatements.filter((statement) =>
    byNormalized.has(normalizeStatement(statement)),
  ).length;

  const reusedOnly = added === 0;
  await KnowledgeRepository.insertDelta({
    projectId: input.projectId,
    clusterId: input.clusterId,
    assetId: assets[0]?.id ?? null,
    addedCount: added,
    supportedCount: supported,
    correctedCount: delta.corrections.length,
    conflictCount: conflictsRecorded,
    reusedOnly,
    summary: delta.summary,
    model,
    promptVersion: EXTRACT_KNOWLEDGE_PROMPT_VERSION,
  });

  return {
    added,
    duplicates,
    supported,
    corrections: delta.corrections,
    conflictsRecorded,
    newQuestions: delta.newQuestions,
    reusedOnly,
    summary: delta.summary,
  };
}

export const KnowledgeExtractionService = {
  extractForCluster,
};
