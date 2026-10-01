import { z } from "zod";
import { OPPORTUNITY_TYPES } from "../rules/scoringRules";

export const INTAKE_PROMPT_VERSION = "opp-intake-v3";

export const intakeSchema = z.object({
  description: z
    .string()
    .describe(
      "One paragraph defining the opportunity: what is sold/automated, who " +
        "buys it, why a supply gap is plausible",
    ),
  type: z.enum(OPPORTUNITY_TYPES).describe("The best-fitting opportunity type"),
  ipRisk: z
    .enum(["green", "yellow", "red"])
    .describe(
      "green = fully generic goods/equipment; yellow = compatible-with a " +
        "brand/IP but generic itself; red = depends on unlicensed IP items",
    ),
  nameZh: z
    .string()
    .max(24)
    .describe("简体中文名称（8 字以内为佳），供中文操作者快速扫读列表"),
  estimatedUnitPriceUsd: z
    .number()
    .min(0)
    .describe(
      "Typical unit price in USD a buyer pays for the CORE product or " +
        "equipment (best estimate from market knowledge)",
    ),
  relatedOpportunities: z
    .array(z.string())
    .max(5)
    .describe(
      "Names of adjacent opportunities in the same ecosystem (parent market " +
        "or siblings), for the relationship graph",
    ),
});

export const INTAKE_SYSTEM = `You register candidate cross-border commercial opportunities for a discovery funnel.

Opportunity types:
- a_b2b_gap: traditional B2B supply gap (industrial spares/equipment; overseas demand, Chinese supply, digitally weak incumbents)
- b_ecosystem: accessories/infrastructure around a large core product or interest
- c_hobby: infrastructure for high-spend hobbies ($500+ entry, long accessory tail)
- d_ip_spillover: GENERIC display/storage/protection infrastructure around collectibles/fandom — never the IP goods themselves
- e_service_automation: equipment ($1k-20k) that standardizes a manual local service

IP risk grading: green = generic products with no IP dependence; yellow = "compatible with brand X" positioning but the product itself is generic; red = the opportunity depends on selling unlicensed IP items. Only green/yellow are ever recommendable — grade honestly.

Describe the opportunity as an OPPORTUNITY (a supply/demand imbalance), not a single product.`;

export function buildIntakePrompt(input: {
  name: string;
  suggestedType: string | null;
  seedNotes: string | null;
}): string {
  return `Candidate opportunity: ${input.name}
${input.suggestedType ? `Type suggested by the operator: ${input.suggestedType}\n` : ""}${input.seedNotes ? `Operator notes: ${input.seedNotes}\n` : ""}
Define it, classify its type, grade its IP risk, and list adjacent opportunities.`;
}
