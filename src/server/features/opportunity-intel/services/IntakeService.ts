import { normalizeKeyword } from "@/server/lib/normalizeKeyword";
import {
  INTAKE_PROMPT_VERSION,
  INTAKE_SYSTEM,
  buildIntakePrompt,
  intakeSchema,
} from "../prompts/intake";
import type { OpportunityType } from "../rules/scoringRules";
import { OpportunitiesRepository } from "../repositories/OpportunitiesRepository";
import { OpportunityDecisionLogRepository } from "../repositories/OpportunityDecisionLogRepository";
import { OpportunityRelationshipsRepository } from "../repositories/OpportunityRelationshipsRepository";
import { runOpportunityLlm } from "./llm";

// Seed intake: normalize + dedup (a name that already exists returns the
// existing opportunity instead of erroring — rejected rows are the dedup
// guard), then one LLM pass that defines the opportunity, checks its type,
// grades IP risk, and suggests graph edges.

type OpportunitySeed = {
  name: string;
  type?: OpportunityType;
  /** ISO short country codes; defaults to ["US"]. */
  targetCountries?: string[];
  languageCode?: string;
  notes?: string;
};

async function addOpportunities(input: {
  organizationId: string;
  seeds: OpportunitySeed[];
  createdBy: "user" | "agent";
  runId?: string | null;
}) {
  const created: Array<{
    id: string;
    name: string;
    type: string;
    ipRisk: string;
  }> = [];
  const duplicates: Array<{
    name: string;
    existingId: string;
    status: string;
  }> = [];

  for (const seed of input.seeds) {
    const normalizedName = normalizeKeyword(seed.name);
    const existing = await OpportunitiesRepository.getByNormalizedName(
      input.organizationId,
      normalizedName,
    );
    if (existing) {
      duplicates.push({
        name: seed.name,
        existingId: existing.id,
        status: existing.status,
      });
      continue;
    }

    const { object, model } = await runOpportunityLlm({
      organizationId: input.organizationId,
      endpoint: "llm_intake",
      schema: intakeSchema,
      system: INTAKE_SYSTEM,
      prompt: buildIntakePrompt({
        name: seed.name,
        suggestedType: seed.type ?? null,
        seedNotes: seed.notes ?? null,
      }),
      runId: input.runId,
    });

    // The operator's explicit type wins over the LLM's classification.
    const type = seed.type ?? object.type;
    const id = await OpportunitiesRepository.insert({
      organizationId: input.organizationId,
      name: seed.name,
      normalizedName,
      type,
      seedNotes: seed.notes ?? null,
      description: object.description,
      targetCountries: seed.targetCountries ?? ["US"],
      languageCode: seed.languageCode ?? "en",
      ipRisk: object.ipRisk,
      estimatedUnitPriceUsd: object.estimatedUnitPriceUsd,
      nameZh: object.nameZh,
    });
    if (!id) {
      const concurrent = await OpportunitiesRepository.getByNormalizedName(
        input.organizationId,
        normalizedName,
      );
      if (!concurrent) {
        throw new Error(
          "Opportunity insert conflicted but the existing row could not be read.",
        );
      }
      duplicates.push({
        name: seed.name,
        existingId: concurrent.id,
        status: concurrent.status,
      });
      continue;
    }

    const relatedLinked: string[] = [];
    for (const relatedName of object.relatedOpportunities) {
      const match = await OpportunitiesRepository.getByNormalizedName(
        input.organizationId,
        normalizeKeyword(relatedName),
      );
      if (!match || match.id === id) continue;
      await OpportunityRelationshipsRepository.insert({
        fromOpportunityId: id,
        toOpportunityId: match.id,
        relation: "similar_to",
      });
      relatedLinked.push(match.id);
    }

    await OpportunityDecisionLogRepository.append({
      opportunityId: id,
      decisionType: "intake",
      inputSnapshot: JSON.stringify(seed),
      decision: JSON.stringify({
        type,
        ipRisk: object.ipRisk,
        estimatedUnitPriceUsd: object.estimatedUnitPriceUsd,
        description: object.description,
        suggestedRelated: object.relatedOpportunities,
        relatedLinked,
      }),
      reasonSummary: `Registered as ${type} with IP risk ${object.ipRisk}.`,
      model,
      promptVersion: INTAKE_PROMPT_VERSION,
      createdBy: input.createdBy,
    });
    created.push({ id, name: seed.name, type, ipRisk: object.ipRisk });
  }

  return { created, duplicates };
}

export const IntakeService = {
  addOpportunities,
};
