import { normalizeKeyword } from "@/server/lib/normalizeKeyword";
import { OpportunityIntelError } from "../opportunityIntelErrors";
import { locationCodesForCountries } from "../locations";
import {
  EXPAND_PROMPT_VERSION,
  EXPAND_SYSTEM,
  buildExpandPrompt,
  expandKeywordsSchema,
} from "../prompts/expandKeywords";
import { EXPANSION_TARGET, type KeywordRole } from "../rules/keywordTemplates";
import { RULE_VERSION } from "../rules/scoringRules";
import { OpportunitiesRepository } from "../repositories/OpportunitiesRepository";
import { OpportunityDecisionLogRepository } from "../repositories/OpportunityDecisionLogRepository";
import { OpportunityKeywordsRepository } from "../repositories/OpportunityKeywordsRepository";
import { runOpportunityLlm } from "./llm";

// Stage 2: expand a DISCOVERED opportunity into its keyword set (one LLM call
// from the versioned type templates), fanned out across the opportunity's
// target countries. Idempotent: an opportunity that already has a full set
// skips the LLM, and the unique index absorbs re-inserted rows.

async function expandOpportunityKeywords(input: {
  organizationId: string;
  opportunityId: string;
  runId?: string | null;
}): Promise<{ added: number; skippedLlm: boolean }> {
  const opportunity = await OpportunitiesRepository.getById(
    input.organizationId,
    input.opportunityId,
  );
  if (!opportunity) {
    throw new OpportunityIntelError(
      "OPPORTUNITY_NOT_FOUND",
      "Opportunity not found.",
    );
  }

  const existing = await OpportunityKeywordsRepository.listByOpportunity(
    input.opportunityId,
  );
  const existingTexts = new Set(existing.map((row) => row.keyword));
  if (existingTexts.size >= EXPANSION_TARGET.min) {
    return { added: 0, skippedLlm: true };
  }

  const { object, model } = await runOpportunityLlm({
    organizationId: input.organizationId,
    endpoint: "llm_expand",
    schema: expandKeywordsSchema,
    system: EXPAND_SYSTEM,
    prompt: buildExpandPrompt({
      name: opportunity.name,
      description: opportunity.description,
      type: opportunity.type,
    }),
    opportunityId: input.opportunityId,
    runId: input.runId,
  });

  // Normalize + dedup (first role wins); the opportunity name itself is the
  // seed keyword.
  const byKeyword = new Map<string, KeywordRole>();
  byKeyword.set(opportunity.normalizedName, "seed");
  for (const entry of object.keywords) {
    const keyword = normalizeKeyword(entry.keyword);
    if (keyword.length === 0 || byKeyword.has(keyword)) continue;
    byKeyword.set(keyword, entry.role);
  }

  const parsedCountries: unknown = JSON.parse(opportunity.targetCountries);
  const countries = Array.isArray(parsedCountries)
    ? parsedCountries.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const locationCodes = locationCodesForCountries(countries);
  const rows = [...byKeyword.entries()].flatMap(([keyword, role]) =>
    locationCodes.map((locationCode) => ({
      keyword,
      role,
      locationCode,
      languageCode: opportunity.languageCode,
    })),
  );
  await OpportunityKeywordsRepository.insertMany(input.opportunityId, rows);

  await OpportunityDecisionLogRepository.append({
    opportunityId: input.opportunityId,
    decisionType: "keyword_expansion",
    decision: JSON.stringify({
      generated: object.keywords.length,
      distinctKeywords: byKeyword.size,
      locationCodes,
    }),
    reasonSummary: `Expanded to ${byKeyword.size} keywords across ${locationCodes.length} market(s).`,
    model,
    promptVersion: EXPAND_PROMPT_VERSION,
    ruleVersion: RULE_VERSION,
    createdBy: "system",
  });

  return { added: rows.length, skippedLlm: false };
}

export const ExpansionService = {
  expandOpportunityKeywords,
};
