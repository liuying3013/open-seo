import { z } from "zod";
import {
  EXPANSION_TARGET,
  KEYWORD_ROLES,
  TEMPLATE_VERSION,
  TYPE_TEMPLATES,
} from "../rules/keywordTemplates";
import type { OpportunityType } from "../rules/scoringRules";

export const EXPAND_PROMPT_VERSION = `opp-expand-v2+${TEMPLATE_VERSION}`;

export const expandKeywordsSchema = z.object({
  keywords: z
    .array(
      z.object({
        keyword: z
          .string()
          .describe(
            "The search query as a person would type it — usually 2-4 words",
          ),
        role: z.enum(KEYWORD_ROLES).describe("Which demand facet it probes"),
      }),
    )
    .min(10)
    .max(EXPANSION_TARGET.max)
    .describe("The expanded keyword set"),
});

// v2 rewrite driven by measured hit rates on the first 3,060 generated
// keywords (2026-09-01): only 12% existed in Google's keyword database, and
// the failure was systematic — 2-word queries hit 60% of the time, 3-word
// 34%, 5-word 8%, 6+ word ~5%, yet two thirds of what v1 produced was 5+
// words. The losers were qualifier stacks and synonym permutations of one
// concept ("commercial espresso machine cleaning station" /
// "...cleaning equipment" / "professional coffee machine cleaning
// equipment"); the winners were short and plain ("dog wash near me",
// "commercial dishwasher", "golf club regripping near me").
export const EXPAND_SYSTEM = `You expand a cross-border commercial opportunity into the keyword set that measures its demand and supply gap.

You are NOT describing the product. You are predicting the exact strings people type into Google. Most real queries are SHORT.

Length discipline (this is the difference between a useful set and a useless one):
- Aim for 2-4 words. Five words needs a reason; six or more is almost always something nobody types.
- Always include the bare head terms on their own ("commercial dishwasher", "pug mill", "skate sharpener") before any qualified variants.
- "near me", "price", "cost", "for sale", "used", "manufacturer", "wholesale", "rental" are the highest-yield modifiers — each attaches to a SHORT head term.

Never do these (measured failure modes):
- Qualifier stacking: "commercial professional espresso machine cleaning station".
- Synonym permutation of one concept: do not emit machine + equipment + system + station + kit variants of the same thing. Pick the one a buyer would actually say.
- Invented spec strings: "helmet sanitizer cabinet 8 helmets", "sanitizing machine 110v". Real spec queries name a REAL brand or model ("hobart am15", "landis 88") — if you cannot name one that exists, skip the query entirely.
- Sentence-like phrases, or the opportunity's full marketing description as a query.

Role meanings: seed = the core query; commercial = buying-intent product queries; service = "done for me" service demand; problem = the pain the product solves; model = real brand/model/part-number queries; supplier = supplier/manufacturer/wholesale sourcing; buyer = what the END BUYERS of a business customer search; comparison = vs/alternative/best queries; info = how-to/what-is background.

Coverage rules:
- Spread across roles; commercial, service, supplier and model queries are worth more than info queries here.
- Genuinely low-volume supplier and real-model queries are still wanted — B2B demand hides in the long tail — but they must be plausible strings, not invented ones.
- Prefer fewer, realistic queries over padding to the maximum. A 60-keyword set where most queries exist beats a 200-keyword set of invented phrases.
- Output lowercase, no punctuation tricks, no duplicates.`;

export function buildExpandPrompt(input: {
  name: string;
  description: string | null;
  type: OpportunityType;
}): string {
  const template = TYPE_TEMPLATES[input.type];
  return `Opportunity: ${input.name}
Type: ${input.type}
${input.description ? `Definition: ${input.description}\n` : ""}
Type guidance: ${template.guidance}

Word bank — these are MODIFIERS to attach to short head terms, not words to
chain together (never stack more than one of them onto a single query):
${template.wordBank.join(", ")}

Generate ${EXPANSION_TARGET.min}-${EXPANSION_TARGET.max} keywords across the roles, most of them 2-4 words.`;
}
