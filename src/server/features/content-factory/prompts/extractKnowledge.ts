import { z } from "zod";
import {
  CLAIM_TYPES,
  KNOWLEDGE_CATEGORIES,
  SOURCE_QUALITIES,
} from "../rules/knowledgeRules";

export const EXTRACT_KNOWLEDGE_PROMPT_VERSION = "extract-knowledge-v1";

/** Body text sent per ranking page. Enough to carry a page's substance without
 * letting eight of them crowd out the brief and the pack. */
const BODY_CHARS_PER_PAGE = 5_000;

export const knowledgeDeltaSchema = z.object({
  claims: z
    .array(
      z.object({
        statement: z
          .string()
          .describe("ONE assertion, not a paragraph. Specific and checkable."),
        claimType: z.enum(CLAIM_TYPES),
        category: z.enum(KNOWLEDGE_CATEGORIES),
        entity: z.string().nullable(),
        applicability: z
          .string()
          .nullable()
          .describe(
            "JSON object of the conditions under which it holds " +
              "(model, config, market, audience). Required for any number.",
          ),
        numericValue: z.number().nullable(),
        numericUnit: z.string().nullable(),
        scope: z
          .enum(["public", "internal"])
          .describe(
            "internal for supplier cost, margin, customer identity, or " +
              "anything not for publication",
          ),
        sourceQuality: z.enum(SOURCE_QUALITIES).nullable(),
        confidence: z.number().min(0).max(1),
        sourceUrl: z
          .string()
          .nullable()
          .describe("The ranking page URL this came from, verbatim, or null"),
        excerpt: z
          .string()
          .nullable()
          .describe("The sentence in that page that supports the claim"),
      }),
    )
    .describe("New claims only. Empty is a valid answer."),
  supportedStatements: z
    .array(z.string())
    .describe(
      "Existing statements this task CONFIRMED, verbatim from the list",
    ),
  corrections: z
    .array(
      z.object({
        existingStatement: z.string(),
        correctedStatement: z.string(),
        why: z.string(),
      }),
    )
    .describe("Existing claims this task showed to be wrong"),
  conflicts: z
    .array(
      z.object({
        existingStatement: z.string(),
        conflictingFinding: z.string(),
        kind: z.enum([
          "value_mismatch",
          "condition_mismatch",
          "stale",
          "contradiction",
        ]),
      }),
    )
    .describe("Contradictions you could NOT resolve — do not guess a winner"),
  newQuestions: z
    .array(z.string())
    .describe("Buyer questions or content gaps this task exposed"),
  summary: z.string().describe("One or two sentences on what this task added"),
});

export const EXTRACT_KNOWLEDGE_SYSTEM = `You extract reusable knowledge from a completed content-operations task.

You are not summarizing the article. You are deciding what this project should still know a year from now, and with what standing.

Hard rules:
- Separate what KIND of claim each finding is, and never upgrade one:
  * fact — checkable against a source. Specs, ratings, dimensions, prices, certifications.
  * judgment — a business or editorial call. "Distributors care more about lead time than finish."
  * observation — true of a moment, not forever. What a SERP looked like on a date.
  * hypothesis — plausible, untested. Say so rather than dressing it as a fact.
- A number without its conditions is useless and slightly dangerous. Any numericValue needs applicability naming the model/config/market it holds for.
- Every fact needs sourceUrl and excerpt pointing at the page that says it. A fact you cannot point at is a hypothesis; file it as one.
- scope=internal for supplier cost, internal margin, customer identity, or anything not for publication. When unsure, choose internal — it is reversible, publishing is not.
- Do not restate claims already in the "known" list as new. Put them in supportedStatements if this task confirmed them.
- An unresolved contradiction goes to conflicts. Do not pick a winner to make the output tidy.
- Extracting nothing is a valid, honest result. An empty claims array is better than padding.`;

export function buildExtractKnowledgePrompt(input: {
  clusterName: string;
  entity: string | null;
  rankingPages: Array<{ url: string; title: string | null; bodyText: string }>;
  unreadableUrls: string[];
  evidencePack: string | null;
  brief: string | null;
  knownStatements: Array<{ statement: string; claimType: string }>;
}): string {
  return `Cluster: ${input.clusterName}
Entity: ${input.entity ?? "(unset)"}

ALREADY KNOWN (do not repeat as new; confirm via supportedStatements):
${
  input.knownStatements
    .map((k) => `- [${k.claimType}] ${k.statement}`)
    .join("\n") || "(nothing recorded for this project yet)"
}

RANKING-PAGE BODIES (${input.rankingPages.length} read):
${
  input.rankingPages
    .map(
      (page) =>
        `--- ${page.url}${page.title ? ` — ${page.title}` : ""}\n${page.bodyText.slice(0, BODY_CHARS_PER_PAGE)}`,
    )
    .join("\n\n") || "(none)"
}

COULD NOT BE OPENED (${input.unreadableUrls.length}) — anything about these is unknown, not inferable:
${input.unreadableUrls.map((url) => `- ${url}`).join("\n") || "(none)"}

APPROVED EVIDENCE PACK:
${input.evidencePack ?? "(none)"}

BRIEF PRODUCED:
${input.brief ?? "(none)"}`;
}
