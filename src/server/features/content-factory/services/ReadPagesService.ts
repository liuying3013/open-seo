import { sort } from "remeda";
import { readPages } from "@/server/lib/scrape";
import { ClustersRepository } from "@/server/features/content-ops/repositories/ClustersRepository";
import { SerpRepository } from "@/server/features/content-ops/repositories/SerpRepository";
import { BudgetService } from "@/server/features/content-ops/services/BudgetService";
import { ContentFactoryError } from "../contentFactoryErrors";
import { ResearchPagesRepository } from "../repositories/ResearchPagesRepository";
import {
  DEFAULT_PAGES_PER_CLUSTER,
  MAX_PAGES_PER_CLUSTER,
  PAGE_FRESHNESS_DAYS,
  READABLE_RESULT_TYPES,
  RESEARCH_PAGE_BODY_LIMIT,
} from "../rules/researchRules";

// The step specs/0013 section 6.3 calls mandatory before any writing: open the
// pages that actually rank and read their bodies. Deciding *whether and where*
// to publish is done from the SERP list alone (content-ops); deciding *what the
// article says* requires this.
//
// Failures are persisted, not swallowed. A page we could not open is evidence
// that a claim has no source — it belongs in the evidence pack's openQuestions,
// never as a fact inferred from a title.

/** Pages ranked below this are rarely worth the read at 8-per-cluster budgets. */
const MAX_RANK_TO_READ = 20;

type PageOutcome = {
  url: string;
  domain: string;
  status: "ok" | "blocked" | "reused";
  wordCount: number | null;
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Pick which ranking URLs to open: readable result types only, our own pages
 * excluded (we are reading them to learn what *others* cover), deduped by URL,
 * best rank first.
 */
function selectCandidates(
  groups: Awaited<ReturnType<typeof SerpRepository.getLatestForCluster>>,
  limit: number,
) {
  const readable = new Set<string>(READABLE_RESULT_TYPES);
  const byUrl = new Map<
    string,
    { url: string; domain: string; rank: number; serpResultId: string }
  >();
  for (const group of groups) {
    for (const result of group.results) {
      if (!readable.has(result.resultType)) continue;
      if (result.isOwned) continue;
      if (result.rank > MAX_RANK_TO_READ) continue;
      const existing = byUrl.get(result.url);
      if (!existing || result.rank < existing.rank) {
        byUrl.set(result.url, {
          url: result.url,
          domain: result.domain,
          rank: result.rank,
          serpResultId: result.id,
        });
      }
    }
  }
  return sort([...byUrl.values()], (a, b) => a.rank - b.rank).slice(
    0,
    Math.min(limit, MAX_PAGES_PER_CLUSTER),
  );
}

/**
 * Read the ranking pages for a cluster whose deployment decision is approved.
 * Consumes 1 `pageReads` budget unit per page actually fetched — reused bodies
 * are free.
 */
async function readClusterPages(input: {
  projectId: string;
  clusterId: string;
  limit?: number;
}): Promise<{ outcomes: PageOutcome[]; openQuestions: string[] }> {
  const cluster = await ClustersRepository.getById(
    input.projectId,
    input.clusterId,
  );
  if (!cluster) {
    throw new ContentFactoryError("CLUSTER_NOT_FOUND", "Cluster not found.");
  }
  // Bodies are read after the deployment decision is approved, never before —
  // reading pages for a cluster we may not publish is spend with no decision
  // attached to it.
  if (cluster.status !== "decided" && cluster.status !== "brief_ready") {
    throw new ContentFactoryError(
      "DECISION_NOT_APPROVED",
      `Ranking pages are read after a deployment decision is approved (cluster status: ${cluster.status}).`,
      { status: cluster.status },
    );
  }

  const groups = await SerpRepository.getLatestForCluster(input.clusterId);
  const candidates = selectCandidates(
    groups,
    input.limit ?? DEFAULT_PAGES_PER_CLUSTER,
  );
  if (candidates.length === 0) {
    throw new ContentFactoryError(
      "NO_PAGES_TO_READ",
      "No readable organic results on this cluster's stored SERPs. Fetch SERPs first.",
    );
  }

  const sinceIso = new Date(
    Date.now() - PAGE_FRESHNESS_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const fresh = await ResearchPagesRepository.getFreshByUrls({
    projectId: input.projectId,
    urls: candidates.map((c) => c.url),
    sinceIso,
  });

  const outcomes: PageOutcome[] = [];
  const openQuestions: string[] = [];

  for (const candidate of candidates) {
    const cached = fresh.get(candidate.url);
    if (cached) {
      if (cached.clusterId !== input.clusterId) {
        // Keep a cluster-specific evidence snapshot without extending freshness.
        await ResearchPagesRepository.insertPage({
          projectId: input.projectId,
          clusterId: input.clusterId,
          serpResultId: candidate.serpResultId,
          url: cached.url,
          domain: cached.domain,
          fetchMethod: cached.fetchMethod,
          fetchStatus: cached.fetchStatus,
          httpStatus: cached.httpStatus,
          title: cached.title,
          bodyText: cached.bodyText,
          objectKey: cached.objectKey,
          contentHash: cached.contentHash,
          wordCount: cached.wordCount,
          fetchedAt: cached.fetchedAt,
        });
      }
      outcomes.push({
        url: candidate.url,
        domain: candidate.domain,
        status: "reused",
        wordCount: cached.wordCount,
      });
      continue;
    }

    await BudgetService.consume(input.projectId, "pageReads");
    // One URL at a time so a failure is attributable: readPages skips what it
    // cannot read, so a batch call would lose which URL failed.
    const result = await readPages([candidate.url], 1);
    const page = result.pages[0];

    if (!page) {
      // scrape.ts does not surface *why* it could not read (SSRF guard,
      // non-2xx, oversize, no text all collapse to "skipped"), so every
      // failure lands on the generic status. The finer values in the enum are
      // reserved for the DataForSEO parsing path, which does report a reason.
      await ResearchPagesRepository.insertPage({
        projectId: input.projectId,
        clusterId: input.clusterId,
        serpResultId: candidate.serpResultId,
        url: candidate.url,
        domain: candidate.domain || hostOf(candidate.url),
        fetchMethod: "read_pages",
        fetchStatus: "blocked",
        httpStatus: null,
        title: null,
        bodyText: null,
        objectKey: null,
        contentHash: null,
        wordCount: null,
      });
      outcomes.push({
        url: candidate.url,
        domain: candidate.domain,
        status: "blocked",
        wordCount: null,
      });
      openQuestions.push(
        `Could not open ${candidate.url} (rank ${candidate.rank}) — anything it covers is unverified.`,
      );
      continue;
    }

    const bodyText = page.text.slice(0, RESEARCH_PAGE_BODY_LIMIT);
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
    await ResearchPagesRepository.insertPage({
      projectId: input.projectId,
      clusterId: input.clusterId,
      serpResultId: candidate.serpResultId,
      url: candidate.url,
      domain: candidate.domain || hostOf(candidate.url),
      fetchMethod: "read_pages",
      fetchStatus: "ok",
      httpStatus: null,
      title: page.title,
      bodyText,
      objectKey: null,
      contentHash: await sha256(bodyText),
      wordCount,
    });
    outcomes.push({
      url: candidate.url,
      domain: candidate.domain,
      status: "ok",
      wordCount,
    });
  }

  return { outcomes, openQuestions };
}

export const ReadPagesService = {
  readClusterPages,
};
