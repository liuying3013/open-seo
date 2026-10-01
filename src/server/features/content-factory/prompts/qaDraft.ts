import { z } from "zod";
import { QA_DIMENSIONS } from "../rules/qaRules";

export const QA_DRAFT_PROMPT_VERSION = "qa-draft-v1";

export const qaReportSchema = z.object({
  findings: z
    .array(
      z.object({
        dimension: z.enum(QA_DIMENSIONS),
        severity: z.enum(["blocker", "fix", "note"]),
        detail: z
          .string()
          .describe("What is wrong and where, specifically enough to act on"),
      }),
    )
    .describe("Empty when the draft is sound. Do not invent findings."),
  ungroundedSentences: z
    .array(z.string())
    .describe("Sentences asserting something no supplied evidence supports"),
  summary: z.string(),
});

export const QA_DRAFT_SYSTEM = `You review a draft against the evidence it was supposed to be written from. You did not write it and you are not here to be encouraging.

Check six things:
- factual_grounding: does every factual sentence trace to the evidence pack, approved knowledge, or the offer? A sentence that sounds authoritative and cites nothing is the failure mode you exist to catch. List those in ungroundedSentences.
- answers_the_query: would someone searching this actually get their answer, early?
- project_boundary: does it stay inside what this business sells and may claim? Writing about an adjacent category we do not stock is a blocker, not a note.
- duplicate_content: does it substantially restate one of our own pages listed in the context?
- expression_quality: padding, throat-clearing, repetition, invented enthusiasm.
- technical_requirements: title and meta length, heading order, internal links pointing only at supplied URLs, structured data matching visible content.

Severity:
- blocker: publishing this would be wrong — a fabricated fact, a prohibited claim, an out-of-boundary topic.
- fix: a real problem a rewrite can solve.
- note: worth knowing, not worth blocking.

An empty findings array is a legitimate result. Inventing a finding to look thorough wastes a rewrite round on a page that was fine.`;

export function buildQaPrompt(input: {
  draft: string;
  evidencePack: string;
  contextRules: string;
  knownClaims: string[];
  prohibitedClaims: string[];
  ourExistingPages: string[];
}): string {
  return `DRAFT UNDER REVIEW:
${input.draft}

EVIDENCE PACK it had to be written from:
${input.evidencePack}

PROJECT RULES:
${input.contextRules}

APPROVED KNOWLEDGE it was also allowed to cite:
${input.knownClaims.map((c) => `- ${c}`).join("\n") || "(none)"}

PROHIBITED CLAIMS:
${input.prohibitedClaims.map((c) => `- ${c}`).join("\n") || "(none recorded)"}

OUR EXISTING PAGES (duplication check):
${input.ourExistingPages.map((u) => `- ${u}`).join("\n") || "(none)"}`;
}
