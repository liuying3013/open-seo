import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { ClustersRepository } from "@/server/features/content-ops/repositories/ClustersRepository";
import { ContentFactoryError } from "../contentFactoryErrors";
import {
  classifyCoverage,
  type CoveragePage,
  COVERAGE_RULE_VERSION,
} from "../rules/coverageRules";

// specs/0013 section 4.2: before a keyword cluster becomes a "write a new page"
// task, check whether we already have the page.
//
// The crawled pages come from the site audit rather than a new table. The audit
// already walks the project's own domain and stores title, word count, internal
// links, indexability and canonical per URL — everything this decision needs.
// A second inventory table would be the same data, kept less fresh.

const MIN_TERM_LENGTH = 3;
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
  "www",
  "com",
  "html",
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

function overlapCount(pageTerms: Set<string>, topicTerms: Set<string>): number {
  let count = 0;
  for (const term of pageTerms) if (topicTerms.has(term)) count += 1;
  return count;
}

async function classifyCluster(input: {
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
  const keywords = await ClustersRepository.getKeywords(input.clusterId);
  const audit = await AuditRepository.getLatestAuditForProject(input.projectId);
  if (!audit) {
    throw new ContentFactoryError(
      "NO_SITE_INVENTORY",
      "No site audit has been run for this project, so there is no inventory of our own pages to compare against. " +
        "Run run_site_audit first — coverage is decided from the crawl, not guessed.",
      { projectId: input.projectId },
    );
  }
  const pages = await AuditRepository.getPagesForAudit(audit.id);

  const topicTerms = termsOf(
    [
      cluster.name,
      cluster.primaryEntity ?? "",
      ...keywords.map((k) => k.keyword),
    ].join(" "),
  );

  const matches: CoveragePage[] = pages.map((page) => ({
    url: page.url,
    title: page.title,
    wordCount: page.wordCount,
    internalLinkCount: page.internalLinkCount,
    isIndexable: page.isIndexable,
    overlap: overlapCount(
      termsOf(`${page.title ?? ""} ${page.url}`),
      topicTerms,
    ),
  }));

  const decision = classifyCoverage(matches);
  return {
    clusterId: input.clusterId,
    clusterName: cluster.name,
    auditId: audit.id,
    crawledPages: pages.length,
    ruleVersion: COVERAGE_RULE_VERSION,
    ...decision,
  };
}

/** The same decision across every cluster of a project, for the task pool. */
async function classifyProject(input: { projectId: string }) {
  const clusters = await ClustersRepository.listByProject(input.projectId);
  const results = [];
  for (const cluster of clusters) {
    results.push(
      await classifyCluster({
        projectId: input.projectId,
        clusterId: cluster.id,
      }),
    );
  }
  return results;
}

export const PageCoverageService = {
  classifyCluster,
  classifyProject,
};
