import { z } from "zod";
import { USER_JOBS } from "../rules/scoringRules";

export const PROPOSE_CLUSTERS_PROMPT_VERSION = "propose-clusters-v1";

export const proposedClusterSchema = z.object({
  clusters: z
    .array(
      z.object({
        name: z
          .string()
          .describe("Short human label, e.g. 'ABB ACS580 vs Siemens G120'"),
        primaryEntity: z
          .string()
          .describe("The concrete entity the cluster centers on"),
        entityCategory: z
          .string()
          .nullable()
          .describe(
            "Project-taxonomy category for the entity, or AMBIGUOUS when the " +
              "query wording could refer to a different product category, or " +
              "null when the project has no taxonomy",
          ),
        userJob: z
          .enum(USER_JOBS)
          .describe("The dominant job the searcher is doing"),
        keywords: z
          .array(z.string())
          .min(1)
          .describe("Normalized keywords belonging to this cluster"),
        representatives: z
          .array(z.string())
          .min(1)
          .max(3)
          .describe(
            "1-3 keywords whose SERPs best represent the cluster (prefer " +
              "higher volume + distinct phrasing)",
          ),
        rationale: z.string().describe("One sentence on why these group"),
      }),
    )
    .describe("Proposed clusters"),
  unassigned: z
    .array(
      z.object({
        keyword: z.string(),
        reason: z
          .string()
          .describe("Why it fits no cluster (off-topic, too vague, ...)"),
      }),
    )
    .describe("Keywords that should not be clustered"),
});

export type ProposedClusters = z.infer<typeof proposedClusterSchema>;

export const PROPOSE_CLUSTERS_SYSTEM = `You group SEO keywords into clusters for a B2B content pipeline.

Rules:
- A cluster = keywords one page/asset can satisfy TOGETHER. Group by (entity, user job), never by string similarity alone. "acs580 manual" (troubleshoot) and "acs580 price" (buy) are DIFFERENT clusters even though they share the entity.
- Every keyword goes to exactly one cluster or to unassigned. Never invent keywords.
- primaryEntity is the concrete product/model/material, not a generic topic.
- If the project defines an entity taxonomy, assign entityCategory from it. When the phrasing could plausibly mean a product category the project does NOT sell, set entityCategory to "AMBIGUOUS" — downstream, ambiguous clusters are blocked until the live SERP disambiguates them. When unsure, prefer AMBIGUOUS over guessing.
- representatives: pick 1-3 keywords whose Google results would best characterize the whole cluster.
- Keep clusters tight: 2-15 keywords is typical. A keyword that stands alone commercially may be its own cluster.`;

export function buildProposeClustersPrompt(input: {
  projectName: string;
  projectDomain: string | null;
  businessContext: string;
  entityTaxonomy: string | null;
  keywords: Array<{
    keyword: string;
    searchVolume: number | null;
    intent: string | null;
    source: string | null;
  }>;
}): string {
  const keywordLines = input.keywords
    .map(
      (k) =>
        `- ${k.keyword} (volume: ${k.searchVolume ?? "?"}, intent: ${k.intent ?? "?"}, source: ${k.source ?? "?"})`,
    )
    .join("\n");
  return `Project: ${input.projectName}${input.projectDomain ? ` (${input.projectDomain})` : ""}

Business context:
${input.businessContext || "(none recorded)"}

${input.entityTaxonomy ? `Entity taxonomy (assign entityCategory from these values, or AMBIGUOUS):\n${input.entityTaxonomy}\n` : ""}
Keywords to cluster (${input.keywords.length}):
${keywordLines}`;
}
