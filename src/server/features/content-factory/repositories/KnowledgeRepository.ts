import { and, desc, eq, inArray, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import {
  contentAssets,
  knowledgeConflicts,
  knowledgeDeltas,
  knowledgeEntries,
  knowledgeSources,
  knowledgeUsages,
} from "@/db/schema";
import type {
  ClaimType,
  KnowledgeCategory,
  KnowledgeStatus,
  SourceQuality,
} from "../rules/knowledgeRules";

type NewSource = {
  researchPageId: string | null;
  sourceType:
    | "ranking_page"
    | "manufacturer_doc"
    | "offer"
    | "project_memory"
    | "gsc"
    | "ga4"
    | "operator"
    | "serp_snapshot";
  url: string | null;
  excerpt: string | null;
  locator: string | null;
  isIndependent: boolean;
  isOwnContent: boolean;
};

type NewEntry = {
  projectId: string;
  claimType: ClaimType;
  category: KnowledgeCategory;
  statement: string;
  normalizedStatement: string;
  entity: string | null;
  applicability: string | null;
  numericValue: number | null;
  numericUnit: string | null;
  scope: "public" | "internal";
  sourceQuality: SourceQuality | null;
  modelConfidence: number | null;
  recheckAfter: string | null;
  ruleVersion: string;
  sources: NewSource[];
};

/** Insert a candidate claim with its sources. Returns null when the statement
 * already exists for this project (the dedupe index) — callers merge instead. */
async function insertCandidate(input: NewEntry): Promise<string | null> {
  const existing = await findByNormalizedStatement(
    input.projectId,
    input.normalizedStatement,
  );
  if (existing) return null;

  const id = crypto.randomUUID();
  const { sources, ...entry } = input;
  await db.insert(knowledgeEntries).values({ id, ...entry });
  await executeInBatches(sources, (tx, source) =>
    tx
      .insert(knowledgeSources)
      .values({ id: crypto.randomUUID(), knowledgeId: id, ...source }),
  );
  return id;
}

async function findByNormalizedStatement(
  projectId: string,
  normalizedStatement: string,
) {
  const rows = await db
    .select()
    .from(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.projectId, projectId),
        eq(knowledgeEntries.normalizedStatement, normalizedStatement),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getById(projectId: string, id: string) {
  const rows = await db
    .select()
    .from(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.id, id),
        eq(knowledgeEntries.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listSources(knowledgeId: string) {
  return db
    .select()
    .from(knowledgeSources)
    .where(eq(knowledgeSources.knowledgeId, knowledgeId));
}

/** Sources for many entries at once, grouped by entry id. */
async function listSourcesFor(knowledgeIds: string[]) {
  if (knowledgeIds.length === 0) return new Map<string, NewSource[]>();
  const rows = await db
    .select()
    .from(knowledgeSources)
    .where(inArray(knowledgeSources.knowledgeId, knowledgeIds));
  const grouped = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    const list = grouped.get(row.knowledgeId) ?? [];
    list.push(row);
    grouped.set(row.knowledgeId, list);
  }
  return grouped;
}

async function listByProject(input: {
  projectId: string;
  status?: KnowledgeStatus;
  entity?: string;
  limit?: number;
}) {
  const filters = [eq(knowledgeEntries.projectId, input.projectId)];
  if (input.status) filters.push(eq(knowledgeEntries.status, input.status));
  if (input.entity) filters.push(eq(knowledgeEntries.entity, input.entity));
  return db
    .select()
    .from(knowledgeEntries)
    .where(and(...filters))
    .orderBy(desc(knowledgeEntries.updatedAt))
    .limit(input.limit ?? 200);
}

/** Approved + public entries, the only ones a writing context may read. */
async function listUsableForWriting(projectId: string, limit = 200) {
  return db
    .select()
    .from(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.projectId, projectId),
        eq(knowledgeEntries.status, "approved"),
        eq(knowledgeEntries.scope, "public"),
      ),
    )
    .orderBy(desc(knowledgeEntries.updatedAt))
    .limit(limit);
}

/** Entries whose recheck date has passed — the "possibly stale" bucket. */
async function listStale(projectId: string, nowIso: string, limit = 100) {
  return db
    .select()
    .from(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.projectId, projectId),
        eq(knowledgeEntries.status, "approved"),
        lte(knowledgeEntries.recheckAfter, nowIso),
      ),
    )
    .limit(limit);
}

async function setStatus(input: {
  projectId: string;
  id: string;
  status: KnowledgeStatus;
  verifiedBy?: "user" | "rule" | "model";
  supersedesId?: string | null;
}) {
  const updated = await db
    .update(knowledgeEntries)
    .set({
      status: input.status,
      updatedAt: new Date().toISOString(),
      ...(input.status === "approved"
        ? { verifiedAt: new Date().toISOString() }
        : {}),
      ...(input.verifiedBy ? { verifiedBy: input.verifiedBy } : {}),
      ...(input.supersedesId === undefined
        ? {}
        : { supersedesId: input.supersedesId }),
    })
    .where(
      and(
        eq(knowledgeEntries.id, input.id),
        eq(knowledgeEntries.projectId, input.projectId),
      ),
    )
    .returning({ id: knowledgeEntries.id });
  return updated.length > 0;
}

async function recordUsage(input: {
  knowledgeId: string;
  assetId: string;
  evidencePackId: string | null;
}) {
  await db
    .insert(knowledgeUsages)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoNothing({
      target: [knowledgeUsages.knowledgeId, knowledgeUsages.assetId],
    });
}

/**
 * Assets that used a claim — the impact query behind gate (d). Returns enough
 * of each asset to raise an update task without a second round trip.
 */
async function listAffectedAssets(knowledgeId: string) {
  return db
    .select({
      assetId: contentAssets.id,
      clusterId: contentAssets.clusterId,
      projectId: contentAssets.projectId,
      platform: contentAssets.platform,
      status: contentAssets.status,
      publishedUrl: contentAssets.publishedUrl,
    })
    .from(knowledgeUsages)
    .innerJoin(contentAssets, eq(contentAssets.id, knowledgeUsages.assetId))
    .where(eq(knowledgeUsages.knowledgeId, knowledgeId));
}

async function insertDelta(input: {
  projectId: string;
  clusterId: string | null;
  assetId: string | null;
  addedCount: number;
  supportedCount: number;
  correctedCount: number;
  conflictCount: number;
  reusedOnly: boolean;
  summary: string | null;
  model: string | null;
  promptVersion: string | null;
}) {
  const id = crypto.randomUUID();
  await db.insert(knowledgeDeltas).values({ id, ...input });
  return id;
}

async function insertConflict(input: {
  projectId: string;
  knowledgeId: string;
  conflictingId: string;
  kind: "value_mismatch" | "condition_mismatch" | "stale" | "contradiction";
  detail: string;
}) {
  const id = crypto.randomUUID();
  await db.insert(knowledgeConflicts).values({ id, ...input });
  return id;
}

async function listOpenConflicts(projectId: string) {
  return db
    .select()
    .from(knowledgeConflicts)
    .where(
      and(
        eq(knowledgeConflicts.projectId, projectId),
        eq(knowledgeConflicts.status, "open"),
      ),
    );
}

/** Entries a human still has to look at: candidates plus disputed ones. */
async function listPendingReview(projectId: string, limit = 100) {
  return db
    .select()
    .from(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.projectId, projectId),
        or(
          eq(knowledgeEntries.status, "candidate"),
          eq(knowledgeEntries.status, "needs_review"),
        ),
      ),
    )
    .orderBy(desc(knowledgeEntries.createdAt))
    .limit(limit);
}

export const KnowledgeRepository = {
  insertCandidate,
  findByNormalizedStatement,
  getById,
  listSources,
  listSourcesFor,
  listByProject,
  listUsableForWriting,
  listStale,
  listPendingReview,
  setStatus,
  recordUsage,
  listAffectedAssets,
  insertDelta,
  insertConflict,
  listOpenConflicts,
};
