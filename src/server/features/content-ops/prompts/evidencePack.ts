import { z } from "zod";

export const EVIDENCE_PACK_PROMPT_VERSION = "evidence-pack-v4";

/**
 * Per-page slice of body text sent to the model. Stored bodies run to
 * RESEARCH_PAGE_BODY_LIMIT; eight of those would swamp one prompt, and the
 * opening section of a ranking page carries the coverage we are measuring.
 */
const BODY_CHARS_PER_PAGE = 6_000;

// The master evidence pack: the single grounded source every platform asset is
// generated from. Structure over prose so downstream briefs can cite pieces.
export const evidencePackContentSchema = z.object({
  targetUser: z.string().describe("Who is searching, in one or two sentences"),
  userJob: z.string().describe("The job they are trying to get done"),
  primaryEntity: z.string(),
  verifiedFacts: z
    .array(z.object({ fact: z.string(), source: z.string() }))
    .describe(
      "Facts grounded in the provided evidence ONLY, each citing its source " +
        "(a SERP result URL, the offer, or project context)",
    ),
  specifications: z
    .string()
    .describe(
      "Known technical specifications/parameters, markdown; empty if none",
    ),
  buyerQuestions: z
    .array(z.string())
    .describe("Real questions buyers ask (PAA, related searches, context)"),
  serpFindings: z
    .string()
    .describe("What the SERP currently rewards: formats, angles, who ranks"),
  competitorGaps: z
    .array(z.string())
    .describe("What ranking pages fail to cover that we can"),
  commercialInfo: z
    .string()
    .describe("Offer, availability, market and conversion path notes"),
  imageIdeas: z
    .array(z.string())
    .describe(
      "Original visuals we could produce (product shots, tables, installs)",
    ),
  allowedClaims: z.array(z.string()),
  prohibitedClaims: z
    .array(z.string())
    .describe(
      "Claims that must NOT be made (unverified performance, fake reviews, " +
        "undisclosed affiliation, competitor disparagement)",
    ),
  brandPosition: z
    .string()
    .describe("How the brand appears: expertise angle, disclosed identity"),
  cta: z.string().describe("The conversion path (WhatsApp / RFQ / page)"),
  openQuestions: z
    .array(z.string())
    .describe(
      "Facts a human must supply before drafting (missing specs, prices)",
    ),
  sources: z.array(z.string()).describe("Every URL/source referenced above"),
});

export type EvidencePackContent = z.infer<typeof evidencePackContentSchema>;

export const EVIDENCE_PACK_SYSTEM = `You build a MASTER EVIDENCE PACK for a B2B content pipeline.

Hard rules:
- Use ONLY the evidence provided in the prompt (ranking-page bodies, SERP results, offer, project context, keyword data). NEVER invent specifications, prices, reviews, or experience.
- Every verifiedFact cites its source. A claim you cannot ground goes to openQuestions instead, and anything tempting-but-unverifiable goes to prohibitedClaims.
- A SERP title or snippet is NOT grounding for a fact. Facts about the world come from a ranking-page BODY, the offer, or project context. Titles and snippets only tell you what a page is about, not what it says.
- competitorGaps must be based on what the page bodies actually cover. "Nobody covers X" is only defensible for pages you were given the body of — say so when the evidence is thin rather than overstating the gap.
- Every URL listed as unreadable goes into openQuestions. Never infer what an unopened page says from its title.
- Anything in OUR OWN VERIFIED KNOWLEDGE is already established. Cite it as a verifiedFact; never put it in openQuestions.
- prohibitedClaims always includes: fabricated hands-on experience, fake independent recommendations, unverified performance numbers, and undisclosed brand affiliation.
- buyerQuestions come from the People-Also-Ask rows and related searches first, then from questions the ranking bodies leave unanswered.
- Write serpFindings as an analyst: which formats rank, which domains own the SERP, what angle is missing.
- The pack is evidence, not copy: no marketing prose.`;

function adjacentCategoryBlock(input: {
  category: string;
  soldCategories: string[];
}): string {
  const sold = input.soldCategories.join(" / ") || "its own range";
  return `
ENTITY RELATION — ADJACENT CATEGORY:
Searchers here want "${input.category}", which this business does NOT sell; it sells ${sold}.
Build the pack for an honest alternative piece: what ${input.category} is and when it is
genuinely the right choice, then where ${sold} fits or wins. Never present the business as a
${input.category} supplier — put that in prohibitedClaims — and make brandPosition the
alternative angle.
`;
}

export function buildEvidencePackPrompt(input: {
  clusterName: string;
  primaryEntity: string | null;
  userJob: string | null;
  keywords: Array<{ keyword: string; searchVolume: number | null }>;
  serpResults: Array<{
    rank: number;
    url: string;
    title: string | null;
    description: string | null;
    resultType: string;
    contentType: string | null;
    isCompetitor: boolean;
  }>;
  paaQuestions: string[];
  relatedSearches: string[];
  /** Bodies we actually opened and read (specs/0013 section 6.3). */
  rankingPageBodies: Array<{
    url: string;
    title: string | null;
    bodyText: string;
  }>;
  /** Pages we tried to open and could not — these become openQuestions. */
  unreadableUrls: string[];
  /**
   * Approved, publishable knowledge this project already holds — including the
   * product facts an operator supplied. Without these the pack keeps asking
   * for specs we have written down elsewhere.
   */
  knownClaims: string[];
  offer: {
    name: string;
    description: string | null;
    marginTier: string;
    readiness: string;
    conversionAssets: string | null;
    notes: string | null;
  } | null;
  businessContext: string;
  /**
   * Set when the cluster's entity is an ADJACENT taxonomy category: one the
   * business does not sell but whose searchers it can serve with what it
   * does. The pack then frames an honest alternative piece, not a seller's.
   */
  adjacentCategory: { category: string; soldCategories: string[] } | null;
  writingPreferences: string | null;
  plannedPlatforms: string[];
}): string {
  const serpLines = input.serpResults
    .slice(0, 30)
    .map(
      (r) =>
        `${r.rank}. [${r.contentType ?? r.resultType}]${r.isCompetitor ? " [competitor]" : ""} ${r.url}\n   ${r.title ?? ""} — ${(r.description ?? "").slice(0, 160)}`,
    )
    .join("\n");
  return `Cluster: ${input.clusterName}
Entity: ${input.primaryEntity ?? "(unset)"} | User job: ${input.userJob ?? "(unset)"}
Keywords: ${input.keywords.map((k) => `${k.keyword} (${k.searchVolume ?? "?"})`).join(", ")}
Planned assets: ${input.plannedPlatforms.join(", ")}

Offer:
${input.offer ? JSON.stringify(input.offer, null, 2) : "(no linked offer)"}

Business context:
${input.businessContext || "(none recorded)"}
${input.adjacentCategory ? adjacentCategoryBlock(input.adjacentCategory) : ""}${input.writingPreferences ? `\nWriting preferences:\n${input.writingPreferences}` : ""}

People Also Ask:
${input.paaQuestions.map((q) => `- ${q}`).join("\n") || "(none)"}

Related searches:
${input.relatedSearches.map((q) => `- ${q}`).join("\n") || "(none)"}

Ranking results (the list — tells you WHAT ranks, not what it says):
${serpLines}

OUR OWN VERIFIED KNOWLEDGE (approved and publishable — cite these directly and
do NOT list them as open questions):
${input.knownClaims.map((c) => `- ${c}`).join("\n") || "(none recorded yet)"}

Ranking-page bodies (${input.rankingPageBodies.length} read — this is the only
evidence of what competitors actually cover):
${
  input.rankingPageBodies
    .map(
      (page) =>
        `--- ${page.url}${page.title ? ` — ${page.title}` : ""}\n${page.bodyText.slice(0, BODY_CHARS_PER_PAGE)}`,
    )
    .join("\n\n") || "(none could be read — see the unreadable list below)"
}

Pages that could NOT be opened (${input.unreadableUrls.length}) — put each of
these in openQuestions; do not infer their content:
${input.unreadableUrls.map((url) => `- ${url}`).join("\n") || "(none)"}`;
}
