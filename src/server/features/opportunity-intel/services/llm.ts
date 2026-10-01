import { generateObject } from "ai";
import type { z } from "zod";
import {
  getStructuredLlmModel,
  withJsonSchemaInstruction,
} from "@/server/lib/openrouter";
import { OpportunityIntelError } from "../opportunityIntelErrors";
import type { CostEndpoint } from "../rules/scoringRules";
import { checkDailyBudget, recordCostEvent } from "./costs";

type LlmEndpoint = Extract<CostEndpoint, `llm_${string}`>;

// The single seam every opportunity-intel LLM call goes through: checks the
// organization's daily llmCalls budget FIRST (fail closed), runs a validated
// generation, and appends a cost-ledger event per attempt (tokens were spent
// either way). Returning the model id lets callers stamp
// opportunity_decision_log rows with it.

/**
 * Transport-level failures worth retrying. Gateways in front of the model
 * (and the model host itself) drop connections, time out, and 5xx under
 * parallel load — a 25-opportunity backfill lost 4 opportunities to exactly
 * these. A schema-validation failure is NOT retried here: the model answered,
 * it just answered wrong, and the AI SDK already retries its own repair pass.
 */
const RETRYABLE = [
  "network",
  "connection",
  "timeout",
  "timed out",
  "aborted",
  "econnreset",
  "socket",
  "fetch failed",
  "internal error",
  "502",
  "503",
  "504",
  "overloaded",
  "rate limit",
  "429",
];

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 800;

function isRetryable(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return RETRYABLE.some((needle) => message.includes(needle));
}

export async function runOpportunityLlm<Schema extends z.ZodType>(input: {
  organizationId: string;
  endpoint: LlmEndpoint;
  schema: Schema;
  system: string;
  prompt: string;
  opportunityId?: string | null;
  runId?: string | null;
}): Promise<{ object: z.infer<Schema>; model: string }> {
  const model = await getStructuredLlmModel();
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Every attempt reserves its own budget unit and writes its own ledger
    // event: a retry really is another request against the provider.
    await checkDailyBudget(input.organizationId, input.endpoint);
    try {
      const result = await generateObject({
        model,
        schema: input.schema,
        system: withJsonSchemaInstruction(input.system, input.schema),
        prompt: input.prompt,
      });
      // generateObject's conditional return type doesn't unify with z.infer
      // for a generic schema; the schema HAS validated the value at runtime.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return { object: result.object as z.infer<Schema>, model: model.modelId };
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS || !isRetryable(error)) break;
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BACKOFF_MS * attempt),
      );
    } finally {
      await recordCostEvent({
        organizationId: input.organizationId,
        provider: "openrouter",
        endpoint: input.endpoint,
        opportunityId: input.opportunityId ?? null,
        runId: input.runId ?? null,
      });
    }
  }

  throw new OpportunityIntelError(
    "LLM_OUTPUT_INVALID",
    `LLM structured generation failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    { model: model.modelId, endpoint: input.endpoint },
  );
}
