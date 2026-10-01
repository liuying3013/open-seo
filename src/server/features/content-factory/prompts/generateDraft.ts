import { z } from "zod";

export const GENERATE_DRAFT_PROMPT_VERSION = "generate-draft-v1";

export const draftSchema = z.object({
  title: z.string(),
  metaDescription: z.string(),
  slug: z.string().describe("URL path segment, lowercase and hyphenated"),
  body: z
    .string()
    .describe("The article in markdown. Structure follows the question."),
  internalLinkTargets: z
    .array(z.object({ url: z.string(), anchor: z.string(), why: z.string() }))
    .describe("Pages of ours this should link to, from the context pack only"),
  imageBriefs: z
    .array(z.string())
    .describe("What to PHOTOGRAPH or produce; never a stock-image suggestion"),
  cta: z.string(),
  structuredDataType: z
    .string()
    .nullable()
    .describe(
      "Schema.org type ONLY if the page visibly contains that content; null otherwise",
    ),
  claimsUsed: z
    .array(z.string())
    .describe("Verbatim statements from the evidence this draft relies on"),
  addedValue: z
    .string()
    .describe("What a reader gets here that the ranking pages do not give"),
});

export const GENERATE_DRAFT_SYSTEM = `You write ONE page from an approved evidence pack and brief.

Hard rules:
- Every factual sentence traces to the evidence pack, the context pack's approved knowledge, or the offer. If it is in none of them, do not write it. Nothing gets rounded up from "probably".
- Structure follows the question, not a template. A buying guide helps someone choose; a price page explains what drives the price; a troubleshooting page helps identify the fault. Do not pad to a section count or a word count.
- Answer first, then explain the mechanism, then say what to do next. A reader who stops after two paragraphs should already have the answer.
- State what this page adds. Verified specs, a clearer selection framework, a procurement checklist, a comparison under stated conditions, a correction of something wrong elsewhere. If you cannot name the addition, the page should not exist.
- Respect prohibitedClaims absolutely. Never invent hands-on experience, customer results, test data, or independent endorsement.
- Internal links come from the pages listed in the context. Do not invent a URL.
- imageBriefs describe what to photograph or draw. A diagram must never be presented as a real product photo or a real installation.
- structuredDataType is null unless the page visibly contains exactly that content. Marking up something a reader cannot see is a policy violation, not an optimization.
- Open questions stay open. Say the information is not established rather than filling the gap.`;

export function buildDraftPrompt(input: {
  brief: string;
  evidencePack: string;
  contextRules: string;
  knownClaims: string[];
  openQuestions: string[];
  internalLinkCandidates: Array<{ url: string; topic: string | null }>;
  writingPreferences: string | null;
}): string {
  return `BRIEF (what to write):
${input.brief}

EVIDENCE PACK (the only permitted source of facts):
${input.evidencePack}

PROJECT RULES (boundaries you may not cross):
${input.contextRules}

APPROVED KNOWLEDGE you may also cite:
${input.knownClaims.map((c) => `- ${c}`).join("\n") || "(none)"}

OPEN QUESTIONS — say these are not established; do NOT fill them:
${input.openQuestions.map((q) => `- ${q}`).join("\n") || "(none)"}

INTERNAL LINK CANDIDATES (the only URLs you may link to):
${
  input.internalLinkCandidates
    .map((p) => `- ${p.url}${p.topic ? ` (${p.topic})` : ""}`)
    .join("\n") || "(none — omit internal links)"
}
${input.writingPreferences ? `\nWRITING PREFERENCES:\n${input.writingPreferences}` : ""}`;
}
