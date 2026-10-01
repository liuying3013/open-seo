import { sort } from "remeda";

// Deterministic rules for "do we already have a page for this?"
// (specs/0013 section 4.2). Pure functions: the verdict is arithmetic over
// crawled page data, and the LLM never gets a vote on whether to merge pages.

export const COVERAGE_RULE_VERSION = "coverage-v1";

/**
 * Term overlap at which a crawled page is judged to be about this cluster.
 * Two shared meaningful terms is deliberately loose — a false "we already have
 * one" is cheap to dismiss in review, while a false "we have nothing" spends a
 * whole content task duplicating a page we own.
 */
const COVERAGE_TERM_THRESHOLD = 2;

/** Below this a page is thin enough that "update" beats "optimize". */
const THIN_PAGE_WORDS = 400;

/** A page nothing links to internally is orphaned however good its copy is. */
const MIN_INTERNAL_LINKS = 2;

const COVERAGE_VERDICTS = [
  "new",
  "update",
  "optimize",
  "merge",
  "skip",
] as const;
type CoverageVerdict = (typeof COVERAGE_VERDICTS)[number];

export type CoveragePage = {
  url: string;
  title: string | null;
  wordCount: number | null;
  internalLinkCount: number | null;
  isIndexable: boolean | null;
  overlap: number;
};

type CoverageDecision = {
  verdict: CoverageVerdict;
  reason: string;
  /** Pages the verdict is about, best match first. */
  pages: CoveragePage[];
  /** Verdicts a human must confirm before anything happens. */
  requiresHumanConfirmation: boolean;
};

/**
 * Five-branch classification. Order matters and is part of the rule version.
 *
 * `merge` never executes anything: consolidating, deleting or moving a URL is
 * not a writing task, and spec section 4.2 puts it behind explicit human
 * confirmation. This function only proposes it.
 */
export function classifyCoverage(matches: CoveragePage[]): CoverageDecision {
  const covering = sort(
    matches.filter((page) => page.overlap >= COVERAGE_TERM_THRESHOLD),
    (a, b) => b.overlap - a.overlap,
  );

  if (covering.length === 0) {
    return {
      verdict: "new",
      reason: "No crawled page of ours covers this topic.",
      pages: [],
      requiresHumanConfirmation: false,
    };
  }

  if (covering.length > 1) {
    return {
      verdict: "merge",
      reason:
        `${covering.length} of our pages cover this topic and compete with each other. ` +
        `Consolidation is a human decision — this is a proposal, nothing has been changed.`,
      pages: covering,
      requiresHumanConfirmation: true,
    };
  }

  const page = covering[0];
  if (page.isIndexable === false) {
    return {
      verdict: "update",
      reason:
        "The covering page is not indexable, so it cannot earn the query.",
      pages: covering,
      requiresHumanConfirmation: false,
    };
  }
  if ((page.wordCount ?? 0) < THIN_PAGE_WORDS) {
    return {
      verdict: "update",
      reason: `The covering page is thin (${page.wordCount ?? 0} words) and does not answer the query fully.`,
      pages: covering,
      requiresHumanConfirmation: false,
    };
  }
  if ((page.internalLinkCount ?? 0) < MIN_INTERNAL_LINKS) {
    return {
      verdict: "optimize",
      reason: `The page has the content but only ${page.internalLinkCount ?? 0} internal link(s); it is close to orphaned.`,
      pages: covering,
      requiresHumanConfirmation: false,
    };
  }
  return {
    verdict: "skip",
    reason:
      "An indexable page of adequate depth already covers this topic and is linked internally.",
    pages: covering,
    requiresHumanConfirmation: false,
  };
}
