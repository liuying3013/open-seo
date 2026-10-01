import { z } from "zod";
import { FINE_INTENTS } from "../rules/scoringRules";

export const CLASSIFY_INTENTS_PROMPT_VERSION = "opp-intents-v1";

export const classifyIntentsSchema = z.object({
  classifications: z
    .array(
      z.object({
        keyword: z.string().describe("The keyword, exactly as given"),
        intent: z.enum(FINE_INTENTS),
      }),
    )
    .describe("One classification per input keyword"),
});

export const CLASSIFY_INTENTS_SYSTEM = `You classify search queries into a fine-grained intent taxonomy for B2B demand measurement.

Taxonomy:
- informational: learning/background ("what is chain wax")
- commercial: researching a purchase ("best chain waxing machine")
- transactional: ready to buy ("chain waxing machine for sale")
- navigational: seeking a specific site/brand
- service: wants the job done for them ("chain waxing service near me")
- supplier: sourcing/wholesale ("chain waxing machine manufacturer")
- replacement: spare/replacement parts ("waxing station heater replacement")
- model: a concrete model/spec/part-number query
- problem: describes the pain ("chain squeaks after degreasing")

Classify every keyword exactly once, copying the keyword text verbatim.`;

export function buildClassifyIntentsPrompt(keywords: string[]): string {
  return `Classify these ${keywords.length} keywords:\n${keywords
    .map((keyword) => `- ${keyword}`)
    .join("\n")}`;
}
