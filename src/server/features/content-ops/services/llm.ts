import { generateObject } from "ai";
import type { z } from "zod";
import {
  getStructuredLlmModel,
  withJsonSchemaInstruction,
} from "@/server/lib/openrouter";
import { ContentOpsError } from "../contentOpsErrors";
import { BudgetService } from "./BudgetService";

// The single seam every content-ops LLM call goes through: consumes the daily
// llmCalls budget FIRST (fail closed), then runs a schema-validated generation.
// Returning the model id lets callers stamp decision_log rows with it.

export async function runStructuredLlm<Schema extends z.ZodType>(input: {
  projectId: string;
  schema: Schema;
  system: string;
  prompt: string;
}): Promise<{ object: z.infer<Schema>; model: string }> {
  await BudgetService.consume(input.projectId, "llmCalls");
  const model = await getStructuredLlmModel();
  try {
    const result = await generateObject({
      model,
      schema: input.schema,
      system: withJsonSchemaInstruction(input.system, input.schema),
      prompt: input.prompt,
    });
    // generateObject's conditional return type doesn't unify with z.infer for a
    // generic schema; the schema HAS validated the value at runtime.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return { object: result.object as z.infer<Schema>, model: model.modelId };
  } catch (error) {
    throw new ContentOpsError(
      "LLM_OUTPUT_INVALID",
      `LLM structured generation failed: ${error instanceof Error ? error.message : String(error)}`,
      { model: model.modelId },
    );
  }
}
