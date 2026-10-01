// Leaf error module (importable by tests without pulling heavy dependencies).
import { AppError } from "@/server/lib/errors";

type ContentOpsErrorCode =
  | "BUDGET_EXCEEDED"
  | "KEYWORDS_ALREADY_CLUSTERED"
  | "KEYWORDS_NOT_FOUND"
  | "CLUSTER_NOT_FOUND"
  | "OFFER_NOT_FOUND"
  | "INVALID_STATUS_TRANSITION"
  | "DISAMBIGUATION_REQUIRED"
  | "SERP_NOT_READY"
  | "RANKING_PAGES_NOT_READ"
  | "DECISION_NOT_FOUND"
  | "EVIDENCE_PACK_NOT_FOUND"
  | "ASSET_NOT_FOUND"
  | "LLM_OUTPUT_INVALID"
  | "VERSION_NOT_FOUND"
  | "ATTEMPT_NOT_FOUND"
  | "STALE_VERSION"
  | "APPROVAL_BLOCKED"
  | "PUBLISH_CONFLICT"
  | "SESSION_REQUIRED"
  | "INVALID_PUBLISH_INPUT";

export class ContentOpsError extends Error {
  readonly code: ContentOpsErrorCode;
  /** Extra machine-readable context (e.g. which keywords conflict, budget remaining). */
  readonly details?: Record<string, unknown>;

  constructor(
    code: ContentOpsErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ContentOpsError";
    this.code = code;
    this.details = details;
  }
}

const APP_ERROR_CODE_FOR: Record<
  ContentOpsErrorCode,
  ConstructorParameters<typeof AppError>[0]
> = {
  BUDGET_EXCEEDED: "RATE_LIMITED",
  KEYWORDS_ALREADY_CLUSTERED: "CONFLICT",
  KEYWORDS_NOT_FOUND: "NOT_FOUND",
  CLUSTER_NOT_FOUND: "NOT_FOUND",
  OFFER_NOT_FOUND: "NOT_FOUND",
  DECISION_NOT_FOUND: "NOT_FOUND",
  EVIDENCE_PACK_NOT_FOUND: "NOT_FOUND",
  ASSET_NOT_FOUND: "NOT_FOUND",
  INVALID_STATUS_TRANSITION: "CONFLICT",
  DISAMBIGUATION_REQUIRED: "CONFLICT",
  SERP_NOT_READY: "CONFLICT",
  RANKING_PAGES_NOT_READ: "CONFLICT",
  LLM_OUTPUT_INVALID: "UPSTREAM_UNAVAILABLE",
  VERSION_NOT_FOUND: "NOT_FOUND",
  ATTEMPT_NOT_FOUND: "NOT_FOUND",
  STALE_VERSION: "CONFLICT",
  APPROVAL_BLOCKED: "CONFLICT",
  PUBLISH_CONFLICT: "CONFLICT",
  SESSION_REQUIRED: "FORBIDDEN",
  INVALID_PUBLISH_INPUT: "VALIDATION_ERROR",
};

/**
 * Entry points (server functions, MCP tools) pass module errors through
 * `.catch(rethrowAsAppError)` so the app-wide error handling recognises them
 * (server functions strip anything that is not an AppError to INTERNAL_ERROR).
 * The message is kept for MCP clients.
 */
export function rethrowAsAppError(error: unknown): never {
  if (error instanceof ContentOpsError) {
    throw new AppError(APP_ERROR_CODE_FOR[error.code], error.message);
  }
  throw error;
}
