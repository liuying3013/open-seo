import { DecisionLogRepository } from "@/server/features/content-ops/repositories/DecisionLogRepository";
import { ContentFactoryError } from "../contentFactoryErrors";
import { KnowledgeRepository } from "../repositories/KnowledgeRepository";
import {
  blocksApprovalAsSelfCitation,
  independentSourceCount,
  isStale,
  isUsableInWriting,
  KNOWLEDGE_RULE_VERSION,
  normalizeStatement,
  recheckAfterFor,
  type ClaimType,
  type KnowledgeCategory,
  type KnowledgeStatus,
  type SourceQuality,
} from "../rules/knowledgeRules";

// The service that enforces specs/0013 section 8's four rules. They live here
// rather than in the prompt because an agent that forgets one produces a
// plausible-looking claim with no way to notice — the same reason the entity
// disambiguation guard is server-side in content-ops.

/**
 * Gate (b). Approving a claim runs the self-citation check first: a `fact`
 * whose sources are all our own published content is the model citing itself,
 * and no amount of confidence makes it evidence.
 */
async function approve(input: {
  projectId: string;
  knowledgeId: string;
  approvedBy: "user" | "rule" | "model";
}) {
  const entry = await KnowledgeRepository.getById(
    input.projectId,
    input.knowledgeId,
  );
  if (!entry) {
    throw new ContentFactoryError(
      "KNOWLEDGE_NOT_FOUND",
      "Knowledge entry not found.",
    );
  }
  const sources = await KnowledgeRepository.listSources(input.knowledgeId);
  if (blocksApprovalAsSelfCitation({ claimType: entry.claimType, sources })) {
    throw new ContentFactoryError(
      "SELF_CITATION_BLOCKED",
      `"${entry.statement}" is a fact whose only sources are our own content. ` +
        `Add an independent source — a manufacturer document, a ranking page, or an operator-supplied ` +
        `spec — before approving it.`,
      { knowledgeId: input.knowledgeId, sourceCount: sources.length },
    );
  }
  const moved = await KnowledgeRepository.setStatus({
    projectId: input.projectId,
    id: input.knowledgeId,
    status: "approved",
    verifiedBy: input.approvedBy,
  });
  if (!moved) {
    throw new ContentFactoryError(
      "KNOWLEDGE_NOT_FOUND",
      "Knowledge entry changed while it was being approved; refresh and retry.",
    );
  }
  return {
    knowledgeId: input.knowledgeId,
    status: "approved" as const,
    independentSources: independentSourceCount(sources),
  };
}

async function setStatus(input: {
  projectId: string;
  knowledgeId: string;
  status: Exclude<KnowledgeStatus, "approved">;
  by: "user" | "rule" | "model";
}) {
  const moved = await KnowledgeRepository.setStatus({
    projectId: input.projectId,
    id: input.knowledgeId,
    status: input.status,
    verifiedBy: input.by,
  });
  if (!moved) {
    throw new ContentFactoryError(
      "KNOWLEDGE_NOT_FOUND",
      "Knowledge entry not found.",
    );
  }
  return { knowledgeId: input.knowledgeId, status: input.status };
}

/**
 * Gate (d). Retracting or superseding a claim looks up every asset that used
 * it and records the impact, so knowledge and published content cannot drift
 * apart quietly.
 *
 * It deliberately does NOT force those assets into a new status: the asset
 * state machine has no `published -> refresh` edge, and inventing one here
 * would let a knowledge correction rewrite publication state behind the
 * operator's back. The affected list is logged and returned instead, which is
 * what puts it in front of a human.
 */
async function retract(input: {
  projectId: string;
  knowledgeId: string;
  reason: string;
  supersededById?: string;
  by: "user" | "rule" | "model";
}) {
  const entry = await KnowledgeRepository.getById(
    input.projectId,
    input.knowledgeId,
  );
  if (!entry) {
    throw new ContentFactoryError(
      "KNOWLEDGE_NOT_FOUND",
      "Knowledge entry not found.",
    );
  }
  const affected = await KnowledgeRepository.listAffectedAssets(
    input.knowledgeId,
  );
  const status = input.supersededById ? "superseded" : "retracted";
  await KnowledgeRepository.setStatus({
    projectId: input.projectId,
    id: input.knowledgeId,
    status,
    verifiedBy: input.by,
  });
  if (input.supersededById) {
    await KnowledgeRepository.setStatus({
      projectId: input.projectId,
      id: input.supersededById,
      status: "approved",
      verifiedBy: input.by,
      supersedesId: input.knowledgeId,
    });
  }

  await DecisionLogRepository.append({
    projectId: input.projectId,
    clusterId: null,
    decisionType: "other",
    inputSnapshot: JSON.stringify({
      stage: "knowledge_retraction",
      knowledgeId: input.knowledgeId,
      statement: entry.statement,
      affectedAssetIds: affected.map((a) => a.assetId),
    }),
    decision: JSON.stringify({ status, supersededById: input.supersededById }),
    reasonSummary:
      `Knowledge ${status}: ${entry.statement}. ${input.reason} ` +
      `${affected.length} asset(s) used it and need review.`,
    ruleVersion: KNOWLEDGE_RULE_VERSION,
    createdBy: input.by === "user" ? "user" : "agent",
  });

  return { knowledgeId: input.knowledgeId, status, affected };
}

/**
 * Gate (a). The only reader a drafting step should use: approved and public
 * only, with the stale ones separated rather than silently mixed in.
 */
async function listForWriting(input: { projectId: string; limit?: number }) {
  const nowIso = new Date().toISOString();
  const rows = await KnowledgeRepository.listUsableForWriting(
    input.projectId,
    input.limit,
  );
  const usable = rows.filter((row) => isUsableInWriting(row));
  return {
    fresh: usable.filter((row) => !isStale(row, nowIso)),
    stale: usable.filter((row) => isStale(row, nowIso)),
  };
}

/** Links a claim to the asset that used it — the input to gate (d) later. */
async function recordUsage(input: {
  knowledgeId: string;
  assetId: string;
  evidencePackId?: string | null;
}) {
  await KnowledgeRepository.recordUsage({
    knowledgeId: input.knowledgeId,
    assetId: input.assetId,
    evidencePackId: input.evidencePackId ?? null,
  });
}

/**
 * Operator-supplied knowledge: the product facts that no competitor page can
 * answer. The first real run's evidence packs asked twelve open questions and
 * eleven were about our own SKUs — dimensions, bend radius, fire reports,
 * warranty, MOQ, price bands. Reading competitors cannot close those; only
 * this can.
 *
 * Entered facts are `approved` immediately when the operator supplies them:
 * a person reading their own spec sheet IS the verification step, and routing
 * them through candidate review would ask them to approve their own typing.
 * Their source is `operator`, never own_content, so the self-citation ban does
 * not misfire on them.
 */
async function addOperatorClaim(input: {
  projectId: string;
  claimType: ClaimType;
  category: KnowledgeCategory;
  statement: string;
  entity?: string | null;
  applicability?: string | null;
  numericValue?: number | null;
  numericUnit?: string | null;
  scope: "public" | "internal";
  sourceQuality?: SourceQuality | null;
  excerpt?: string | null;
}) {
  const normalized = normalizeStatement(input.statement);
  const existing = await KnowledgeRepository.findByNormalizedStatement(
    input.projectId,
    normalized,
  );
  if (existing) {
    return { knowledgeId: existing.id, created: false as const };
  }
  const now = new Date().toISOString();
  const id = await KnowledgeRepository.insertCandidate({
    projectId: input.projectId,
    claimType: input.claimType,
    category: input.category,
    statement: input.statement,
    normalizedStatement: normalized,
    entity: input.entity ?? null,
    applicability: input.applicability ?? null,
    numericValue: input.numericValue ?? null,
    numericUnit: input.numericUnit ?? null,
    scope: input.scope,
    sourceQuality: input.sourceQuality ?? "primary",
    modelConfidence: null,
    recheckAfter: recheckAfterFor(input.category, now),
    ruleVersion: KNOWLEDGE_RULE_VERSION,
    sources: [
      {
        researchPageId: null,
        sourceType: "operator",
        url: null,
        excerpt: input.excerpt ?? null,
        locator: null,
        isIndependent: true,
        isOwnContent: false,
      },
    ],
  });
  if (!id) {
    throw new ContentFactoryError(
      "KNOWLEDGE_NOT_FOUND",
      "The claim could not be stored; it may have been added concurrently.",
    );
  }
  await KnowledgeRepository.setStatus({
    projectId: input.projectId,
    id,
    status: "approved",
    verifiedBy: "user",
  });
  return { knowledgeId: id, created: true as const };
}

export const KnowledgeService = {
  addOperatorClaim,
  approve,
  setStatus,
  retract,
  listForWriting,
  recordUsage,
};
