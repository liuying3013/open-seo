import { z } from "zod";
import { SERP_CONTENT_TYPES } from "../rules/scoringRules";

export const ANALYZE_CLUSTER_PROMPT_VERSION = "analyze-cluster-v1";

export const analyzeClusterSchema = z.object({
  contentTypes: z
    .array(
      z.object({
        url: z.string(),
        contentType: z.enum(SERP_CONTENT_TYPES),
      }),
    )
    .describe("One entry per listed result URL, classified by page format"),
  dominantEntitySense: z
    .string()
    .nullable()
    .describe(
      "Only when asked to disambiguate: the taxonomy category the SERP's " +
        "dominant results actually refer to; null when not asked",
    ),
  disambiguationConfidence: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .describe("Confidence in dominantEntitySense; null when not asked"),
  disambiguationReason: z
    .string()
    .nullable()
    .describe("One sentence citing which ranked results show the sense"),
});

export const ANALYZE_CLUSTER_SYSTEM = `You classify Google search results for an SEO decision system.

For every result URL listed, judge the PAGE FORMAT from its title, snippet and URL:
- product: a single product/model page
- category: a product listing/category page
- commercial_landing: a service/commercial landing page
- guide: an explainer, how-to, tutorial or documentation page
- comparison: an X-vs-Y or alternatives page
- listicle: a "best/top N" list
- forum_thread / qna: community discussion or Q&A
- video / pdf: those formats
- brand_home: a company homepage
- other: none of the above

When the prompt asks you to disambiguate the entity, look at what the DOMINANT ranked results are actually about and pick the taxonomy category that matches; do not pick the category the business wishes for. Cite ranks in your reason.`;

export function buildAnalyzeClusterPrompt(input: {
  clusterName: string;
  primaryEntity: string | null;
  keywords: string[];
  results: Array<{
    rank: number;
    url: string;
    title: string | null;
    description: string | null;
  }>;
  disambiguate: {
    taxonomy: string;
    currentCategory: string;
  } | null;
}): string {
  const resultLines = input.results
    .map(
      (r) =>
        `${r.rank}. ${r.url}\n   title: ${r.title ?? "(none)"}\n   snippet: ${(r.description ?? "").slice(0, 200)}`,
    )
    .join("\n");
  return `Cluster: ${input.clusterName}${input.primaryEntity ? ` (entity: ${input.primaryEntity})` : ""}
Queries: ${input.keywords.join(", ")}

${
  input.disambiguate
    ? `DISAMBIGUATION REQUIRED. The entity is currently "${input.disambiguate.currentCategory}".
Taxonomy:
${input.disambiguate.taxonomy}

Set dominantEntitySense to the taxonomy category the dominant results refer to.
`
    : "No disambiguation needed: set dominantEntitySense, disambiguationConfidence and disambiguationReason to null.\n"
}
Results to classify:
${resultLines}`;
}
