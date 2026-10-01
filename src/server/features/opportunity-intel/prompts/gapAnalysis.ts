import { z } from "zod";
import { PAGE_CLASSES } from "../rules/scoringRules";

export const GAP_PROMPT_VERSION = "opp-gap-v1";

export const gapAnalysisSchema = z.object({
  classifications: z
    .array(
      z.object({
        index: z.number().int().describe("The result's index, as given"),
        pageClass: z.enum(PAGE_CLASSES),
      }),
    )
    .describe("One classification per input result"),
  intentMismatch: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "How much the ranking pages fail the query's commercial intent (1 = a " +
        "buyer finds nothing to buy/source here)",
    ),
  weakDomainShare: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Share of results that look like weak/thin sites (template pages, " +
        "scraped catalogs, low-effort content)",
    ),
  outdatedShare: z
    .number()
    .min(0)
    .max(1)
    .describe("Share of results that look years out of date"),
  notes: z
    .string()
    .describe("One or two sentences on the supply gap, citing result indexes"),
});

export const GAP_SYSTEM = `You analyze a Google SERP for supply-gap evidence: does a commercial buyer searching this query find dedicated suppliers, or filler?

Page classes:
- supplier / manufacturer / distributor: a dedicated commercial site selling or sourcing the thing
- marketplace: Amazon/Alibaba/eBay/Etsy-style aggregator listings
- niche_store: a small specialized shop
- brand_home: a brand's own site
- guide / comparison: editorial content
- forum_thread / qna: community discussion (Reddit, Quora, PAA answers)
- video / pdf / directory / social / news / other: as named

Judge only from rank, domain, title, description. A SERP full of forums, PDFs, marketplaces, and outdated pages for a commercially-intended query is STRONG gap evidence; a SERP of dedicated suppliers means the intent is already served.`;

export function buildGapPrompt(input: {
  keyword: string;
  results: Array<{
    index: number;
    rank: number;
    domain: string;
    title: string | null;
    description: string | null;
    resultType: string;
  }>;
}): string {
  const lines = input.results
    .map(
      (result) =>
        `${result.index}. [rank ${result.rank}, ${result.resultType}] ${result.domain} — ${result.title ?? "(no title)"}${result.description ? ` | ${result.description}` : ""}`,
    )
    .join("\n");
  return `Query: "${input.keyword}"

Results:
${lines}

Classify every result by index and estimate the snapshot-level signals.`;
}
