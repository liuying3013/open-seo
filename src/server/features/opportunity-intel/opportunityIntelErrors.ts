// Leaf error module (importable by tests without pulling heavy dependencies).
import { AppError } from "@/server/lib/errors";

type OpportunityIntelErrorCode =
  | "BUDGET_EXCEEDED"
  | "OPPORTUNITY_NOT_FOUND"
  | "INVALID_STATUS_TRANSITION"
  | "LLM_OUTPUT_INVALID"
  | "GRADUATION_NOT_ALLOWED"
  | "PROJECT_NOT_FOUND"
  | "REPORT_NOT_FOUND"
  | "RUN_ALREADY_ACTIVE";

export class OpportunityIntelError extends Error {
  readonly code: OpportunityIntelErrorCode;
  /** Extra machine-readable context (e.g. remaining budget, conflicting ids). */
  readonly details?: Record<string, unknown>;

  constructor(
    code: OpportunityIntelErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "OpportunityIntelError";
    this.code = code;
    this.details = details;
  }
}

const APP_ERROR_CODE_FOR: Record<
  OpportunityIntelErrorCode,
  ConstructorParameters<typeof AppError>[0]
> = {
  BUDGET_EXCEEDED: "RATE_LIMITED",
  OPPORTUNITY_NOT_FOUND: "NOT_FOUND",
  PROJECT_NOT_FOUND: "NOT_FOUND",
  REPORT_NOT_FOUND: "NOT_FOUND",
  INVALID_STATUS_TRANSITION: "CONFLICT",
  GRADUATION_NOT_ALLOWED: "CONFLICT",
  RUN_ALREADY_ACTIVE: "CONFLICT",
  LLM_OUTPUT_INVALID: "UPSTREAM_UNAVAILABLE",
};

/**
 * Entry points (server functions, MCP tools) pass module errors through
 * `.catch(rethrowAsAppError)` so the app-wide error handling recognises them:
 * server functions strip anything that is not an AppError to INTERNAL_ERROR,
 * and MCP instrumentation would report these expected failures as exceptions.
 * The message is kept for MCP clients.
 */
export function rethrowAsAppError(error: unknown): never {
  if (error instanceof OpportunityIntelError) {
    throw new AppError(APP_ERROR_CODE_FOR[error.code], error.message);
  }
  throw error;
}
