import { sort } from "remeda";
import { getProjectContext } from "@/server/features/project-context/services/ProjectContextService";
import { ClustersRepository } from "@/server/features/content-ops/repositories/ClustersRepository";
import { AssetsRepository } from "@/server/features/content-ops/repositories/AssetsRepository";
import { ContentFactoryError } from "../contentFactoryErrors";
import { KnowledgeRepository } from "../repositories/KnowledgeRepository";
import { ResearchPagesRepository } from "../repositories/ResearchPagesRepository";
import { isStale } from "../rules/knowledgeRules";

// specs/0013 section 5: what the project already knows, assembled BEFORE this
// task's research so the same ground is not bought twice.
//
// Three layers with different loading rules, and one output rule that matters
// more than any of them: the pack must say which of its contents are settled,
// which may have gone stale, and which questions are still open. A context pack
// that presents all three as equally true is worse than none.

/** Layer 2 is retrieved, not dumped: only what this topic actually needs. */
const MAX_KNOWLEDGE_ENTRIES = 40;
const MIN_TERM_LENGTH = 3;

/** Terms too common in this domain to discriminate between topics. */
const STOP_TERMS = new Set([
  "the",
  "and",
  "for",
  "with",
  "what",
  "how",
  "best",
  "from",
  "are",
  "buy",
]);

function termsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(
        (term) => term.length >= MIN_TERM_LENGTH && !STOP_TERMS.has(term),
      ),
  );
}

/**
 * Relevance by term overlap. Deliberately not a vector search: spec section 15
 * says start with structured filtering plus text matching and only add
 * embeddings if retrieval quality actually demands it. At a few hundred entries
 * per project this runs in memory and stays explainable — you can see exactly
 * why an entry surfaced.
 */
function relevanceScore(
  entry: { statement: string; entity: string | null },
  topicTerms: Set<string>,
): number {
  const entryTerms = termsOf(
    `${entry.statement} ${entry.entity ?? ""}`.toString(),
  );
  let overlap = 0;
  for (const term of entryTerms) if (topicTerms.has(term)) overlap += 1;
  // Same-entity entries are relevant even when the wording diverges.
  const entityBonus =
    entry.entity && topicTerms.has(entry.entity.toLowerCase().split(/\s+/)[0])
      ? 2
      : 0;
  return overlap + entityBonus;
}

async function buildForCluster(input: {
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

  const [context, keywords, knowledge, pages, assets] = await Promise.all([
    getProjectContext(input.projectId),
    ClustersRepository.getKeywords(input.clusterId),
    KnowledgeRepository.listUsableForWriting(input.projectId, 400),
    ResearchPagesRepository.getLatestForCluster(input.clusterId),
    AssetsRepository.listByCluster(input.clusterId),
  ]);

  const sections = new Map(context.sections.map((s) => [s.key, s.content]));
  const nowIso = new Date().toISOString();

  // --- Layer 1: project rules. Loaded in full, every time. -----------------
  // These are the boundaries a task must not cross (what we sell, who we sell
  // to, what we may claim). Retrieving them "when relevant" is how a task ends
  // up writing about a category the business does not stock.
  const rules = {
    businessOverview: sections.get("business_overview") ?? null,
    positioning: sections.get("positioning") ?? null,
    currentGoal: sections.get("current_goal") ?? null,
    writingPreferences: sections.get("writing_preferences") ?? null,
    entityTaxonomy:
      context.customSections.find((s) => s.slug === "entity-taxonomy")
        ?.content ?? null,
    competitors: context.competitors.map((c) => c.domain),
  };

  // --- Layer 2: long-term knowledge relevant to THIS topic ------------------
  const topicTerms = termsOf(
    [
      cluster.name,
      cluster.primaryEntity ?? "",
      ...keywords.map((k) => k.keyword),
    ].join(" "),
  );
  const ranked = sort(
    knowledge
      .map((entry) => ({ entry, score: relevanceScore(entry, topicTerms) }))
      .filter((row) => row.score > 0),
    (a, b) => b.score - a.score,
  ).slice(0, MAX_KNOWLEDGE_ENTRIES);

  const known = ranked
    .filter((row) => !isStale(row.entry, nowIso))
    .map((row) => summarize(row.entry));
  const possiblyStale = ranked
    .filter((row) => isStale(row.entry, nowIso))
    .map((row) => summarize(row.entry));

  // --- Layer 3: what we have already written, and how ----------------------
  const coveringPages = context.keyPages
    .filter(
      (page) =>
        relevanceScore(
          { statement: `${page.topic ?? ""} ${page.url}`, entity: null },
          topicTerms,
        ) > 0,
    )
    .map((page) => ({
      url: page.url,
      role: page.role,
      topic: page.topic,
      notes: page.notes,
    }));
  const priorAssets = assets
    .filter((asset) => asset.brief)
    .map((asset) => ({
      platform: asset.platform,
      angle: asset.angle,
      status: asset.status,
    }));

  // --- The output rule: separate settled from unsettled --------------------
  const conflicts = await KnowledgeRepository.listOpenConflicts(
    input.projectId,
  );
  const openQuestions = [
    ...pages
      .filter((page) => page.fetchStatus !== "ok")
      .map(
        (page) => `Could not read ${page.url} — anything it covers is unknown.`,
      ),
    ...conflicts.map(
      (conflict) =>
        `Unresolved conflict: ${conflict.detail} (${conflict.kind})`,
    ),
    ...(rules.entityTaxonomy === null && cluster.entityCategory === "AMBIGUOUS"
      ? [
          `Cluster entity is AMBIGUOUS and the project has no entity-taxonomy section to resolve it against.`,
        ]
      : []),
  ];

  return {
    cluster: {
      id: cluster.id,
      name: cluster.name,
      entity: cluster.primaryEntity,
      userJob: cluster.userJob,
      entityCategory: cluster.entityCategory,
    },
    rules,
    known,
    possiblyStale,
    openQuestions,
    coveringPages,
    priorAssets,
    researchLog: context.researchLog.slice(0, 10).map((entry) => ({
      entryDate: entry.entryDate,
      summary: entry.summary,
    })),
  };
}

function summarize(entry: {
  id: string;
  statement: string;
  claimType: string;
  category: string;
  entity: string | null;
  applicability: string | null;
  recheckAfter: string | null;
}) {
  return {
    id: entry.id,
    statement: entry.statement,
    claimType: entry.claimType,
    category: entry.category,
    entity: entry.entity,
    applicability: entry.applicability,
    recheckAfter: entry.recheckAfter,
  };
}

export const ContextPackService = {
  buildForCluster,
};
