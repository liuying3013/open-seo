import { z } from "zod";
import { ContentOpsError } from "../contentOpsErrors";
import { RULE_VERSION } from "../rules/scoringRules";
import {
  EVIDENCE_PACK_PROMPT_VERSION,
  EVIDENCE_PACK_SYSTEM,
  buildEvidencePackPrompt,
  evidencePackContentSchema,
} from "../prompts/evidencePack";
import { AssetsRepository } from "../repositories/AssetsRepository";
import { ClustersRepository } from "../repositories/ClustersRepository";
import { DecisionLogRepository } from "../repositories/DecisionLogRepository";
import { EvidencePacksRepository } from "../repositories/EvidencePacksRepository";
import { OffersRepository } from "../repositories/OffersRepository";
import { SerpRepository } from "../repositories/SerpRepository";
import { getProjectContext } from "@/server/features/project-context/services/ProjectContextService";
import { runStructuredLlm } from "./llm";
import {
  ENTITY_TAXONOMY_SLUG,
  classifyEntityRelation,
  parseEntityTaxonomy,
} from "../rules/entityRules";

// The evidence pack is generated from STORED evidence only (ranking-page
// bodies, SERP rows, offer, project memory) and versioned per cluster. Drafts
// need human approval before briefs are generated from them — that approval is
// the anti-hallucination gate for everything downstream.
//
// Building a pack requires that someone actually opened the ranking pages
// first (specs/0013 section 6.3). SERP titles and snippets settle page type and
// platform verdicts; they are not evidence of what a competitor page says, and
// a pack built from them alone reads like a deployment note pretending to be a
// writing brief. The gate below is enforced server-side rather than left to
// the agent, matching the entity-disambiguation guard.

// TODO(content-factory port, step 3b): content-factory owns the ranking-page
// bodies and the knowledge base; content-ops reads them here. Until that module
// is ported these are empty, so buildPack always stops at the
// RANKING_PAGES_NOT_READ gate. Restore from seo-ops:
//   researchPages = ResearchPagesRepository.getLatestForCluster(clusterId)
//     (@/server/features/content-factory/repositories/ResearchPagesRepository)
//   knowledge = KnowledgeService.listForWriting({ projectId })
//     (@/server/features/content-factory/services/KnowledgeService)
// and bring back EvidencePackService.test.ts from seo-ops with it.
type RankingPage = {
  url: string;
  title: string | null;
  bodyText: string | null;
  fetchStatus: string;
};
const noResearchPages: RankingPage[] = [];
const noKnowledge: { fresh: Array<{ statement: string }> } = { fresh: [] };

const serpFeaturesSchema = z
  .object({
    features: z.array(z.string()).default([]),
    relatedSearches: z.array(z.string()).default([]),
  })
  .or(z.null());

async function buildPack(input: { projectId: string; clusterId: string }) {
  const cluster = await ClustersRepository.getById(
    input.projectId,
    input.clusterId,
  );
  if (!cluster) {
    throw new ContentOpsError("CLUSTER_NOT_FOUND", "Cluster not found.");
  }
  if (cluster.status !== "decided" && cluster.status !== "brief_ready") {
    throw new ContentOpsError(
      "SERP_NOT_READY",
      `Evidence packs are built after decision approval (status: ${cluster.status}).`,
    );
  }

  const [keywords, snapshotGroups, assets, context] = await Promise.all([
    ClustersRepository.getKeywords(input.clusterId),
    SerpRepository.getLatestForCluster(input.clusterId),
    AssetsRepository.listByCluster(input.clusterId),
    getProjectContext(input.projectId),
  ]);
  const researchPages = noResearchPages;
  // Facts the project already holds — chiefly the operator-supplied product
  // specs. Feeding them in is what stops the pack asking for the same SKU
  // dimensions on every cluster.
  const knowledge = noKnowledge;

  if (researchPages.length === 0) {
    throw new ContentOpsError(
      "RANKING_PAGES_NOT_READ",
      "No ranking pages have been read for this cluster. Run read_ranking_pages first — " +
        "SERP titles and snippets decide page type and platforms, but they are not evidence " +
        "of what the ranking pages actually say.",
      { clusterId: input.clusterId },
    );
  }
  // Failed attempts stay in the set on purpose: a page we could not open is
  // exactly what the model must declare as an open question instead of
  // guessing from its title.
  const rankingPageBodies = researchPages
    .filter((page) => page.fetchStatus === "ok" && page.bodyText)
    .map((page) => ({
      url: page.url,
      title: page.title,
      bodyText: page.bodyText ?? "",
    }));
  const unreadableUrls = researchPages
    .filter((page) => page.fetchStatus !== "ok")
    .map((page) => page.url);
  const offer = cluster.offerId
    ? await OffersRepository.getById(input.projectId, cluster.offerId)
    : null;

  const allResults = snapshotGroups.flatMap((group) => group.results);
  const paaQuestions = [
    ...new Set(
      allResults
        .filter((r) => r.resultType === "people_also_ask" && r.title)
        .map((r) => r.title!),
    ),
  ];
  const relatedSearches = [
    ...new Set(
      snapshotGroups.flatMap((group) => {
        const parsed = serpFeaturesSchema.safeParse(
          JSON.parse(group.snapshot.serpFeatures ?? "null"),
        );
        return parsed.success && parsed.data ? parsed.data.relatedSearches : [];
      }),
    ),
  ];

  const sections = new Map(
    context.sections.map((section) => [section.key, section.content]),
  );
  // An adjacent category (brick veneer for an MCM seller) gets an alternative
  // piece, and the pack has to know that or it writes a seller's page for a
  // product the business does not have.
  const taxonomyText =
    context.customSections.find((s) => s.slug === ENTITY_TAXONOMY_SLUG)
      ?.content ?? null;
  const entityRelation = classifyEntityRelation({
    taxonomy: taxonomyText,
    entityCategory: cluster.entityCategory,
  });
  const adjacentCategory =
    entityRelation === "adjacent" && cluster.entityCategory
      ? {
          category: cluster.entityCategory,
          soldCategories: parseEntityTaxonomy(taxonomyText).target,
        }
      : null;
  const { object: content, model } = await runStructuredLlm({
    projectId: input.projectId,
    schema: evidencePackContentSchema,
    system: EVIDENCE_PACK_SYSTEM,
    prompt: buildEvidencePackPrompt({
      clusterName: cluster.name,
      primaryEntity: cluster.primaryEntity,
      userJob: cluster.userJob,
      keywords: keywords.map((k) => ({
        keyword: k.keyword,
        searchVolume: k.searchVolume,
      })),
      serpResults: allResults.map((r) => ({
        rank: r.rank,
        url: r.url,
        title: r.title,
        description: r.description,
        resultType: r.resultType,
        contentType: r.contentType,
        isCompetitor: r.isCompetitor,
      })),
      paaQuestions,
      relatedSearches,
      rankingPageBodies,
      unreadableUrls,
      knownClaims: knowledge.fresh.map((entry) => entry.statement),
      offer: offer
        ? {
            name: offer.name,
            description: offer.description,
            marginTier: offer.marginTier,
            readiness: offer.readiness,
            conversionAssets: offer.conversionAssets,
            notes: offer.notes,
          }
        : null,
      businessContext: [
        sections.get("business_overview") ?? "",
        sections.get("positioning") ?? "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      adjacentCategory,
      writingPreferences: sections.get("writing_preferences") ?? null,
      plannedPlatforms: assets.map((asset) => asset.platform),
    }),
  });

  const { id, version } = await EvidencePacksRepository.insertVersion({
    projectId: input.projectId,
    clusterId: input.clusterId,
    content: JSON.stringify(content),
  });

  await DecisionLogRepository.append({
    projectId: input.projectId,
    clusterId: input.clusterId,
    decisionType: "brief",
    inputSnapshot: JSON.stringify({
      stage: "evidence_pack",
      snapshotIds: snapshotGroups.map((g) => g.snapshot.id),
      offerId: offer?.id ?? null,
      plannedPlatforms: assets.map((asset) => asset.platform),
      // "Which pages did this article read?" must be answerable from the log
      // alone, not from anyone's memory.
      readPageUrls: rankingPageBodies.map((page) => page.url),
      unreadableUrls,
    }),
    decision: JSON.stringify({
      packId: id,
      version,
      verifiedFactCount: content.verifiedFacts.length,
      openQuestionCount: content.openQuestions.length,
    }),
    reasonSummary: `Evidence pack v${version}: ${content.verifiedFacts.length} facts, ${content.openQuestions.length} open questions, from ${rankingPageBodies.length} page bodies (${unreadableUrls.length} unreadable).`,
    model,
    promptVersion: EVIDENCE_PACK_PROMPT_VERSION,
    ruleVersion: RULE_VERSION,
    createdBy: "agent",
  });

  return { packId: id, version, content };
}

/** Human gate: only approved packs can feed brief generation. */
async function approvePack(input: { projectId: string; packId: string }) {
  const pack = await EvidencePacksRepository.getById(
    input.projectId,
    input.packId,
  );
  if (!pack) {
    throw new ContentOpsError(
      "EVIDENCE_PACK_NOT_FOUND",
      "Evidence pack not found.",
    );
  }
  if (pack.status === "approved") {
    return { packId: input.packId, status: "approved" as const };
  }
  const approved = await EvidencePacksRepository.approve(
    input.projectId,
    input.packId,
  );
  if (!approved) {
    const current = await EvidencePacksRepository.getById(
      input.projectId,
      input.packId,
    );
    if (current?.status === "approved") {
      return { packId: input.packId, status: "approved" as const };
    }
    throw new ContentOpsError(
      "EVIDENCE_PACK_NOT_FOUND",
      "Evidence pack changed while it was being approved; refresh and try again.",
    );
  }
  await DecisionLogRepository.append({
    projectId: input.projectId,
    clusterId: pack.clusterId,
    decisionType: "brief",
    decision: JSON.stringify({
      packId: input.packId,
      action: "approve_pack",
      version: pack.version,
    }),
    reasonSummary: `Evidence pack v${pack.version} approved.`,
    ruleVersion: RULE_VERSION,
    createdBy: "user",
  });
  return { packId: input.packId, status: "approved" as const };
}

export const EvidencePackService = {
  buildPack,
  approvePack,
};
