// Leaf error module (importable by tests without pulling heavy dependencies).
import { rethrowAsAppError as rethrowContentOpsAsAppError } from "@/server/features/content-ops/contentOpsErrors";
import { AppError } from "@/server/lib/errors";

type ContentFactoryErrorCode =
  | "BUDGET_EXCEEDED"
  | "CLUSTER_NOT_FOUND"
  | "DECISION_NOT_APPROVED"
  | "NO_PAGES_TO_READ"
  | "KNOWLEDGE_NOT_FOUND"
  | "SELF_CITATION_BLOCKED"
  | "NO_EXTRACTION_INPUT"
  | "NO_SITE_INVENTORY"
  | "ASSET_NOT_FOUND"
  | "NO_BRIEF"
  | "NO_DRAFT"
  | "EVIDENCE_PACK_NOT_APPROVED";

export class ContentFactoryError extends Error {
  readonly code: ContentFactoryErrorCode;
  /** Extra machine-readable context (e.g. which cluster, budget remaining). */
  readonly details?: Record<string, unknown>;

  constructor(
    code: ContentFactoryErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ContentFactoryError";
    this.code = code;
    this.details = details;
  }
}

const APP_ERROR_CODE_FOR: Record<
  ContentFactoryErrorCode,
  ConstructorParameters<typeof AppError>[0]
> = {
  BUDGET_EXCEEDED: "RATE_LIMITED",
  CLUSTER_NOT_FOUND: "NOT_FOUND",
  DECISION_NOT_APPROVED: "CONFLICT",
  NO_PAGES_TO_READ: "CONFLICT",
  KNOWLEDGE_NOT_FOUND: "NOT_FOUND",
  SELF_CITATION_BLOCKED: "CONFLICT",
  NO_EXTRACTION_INPUT: "VALIDATION_ERROR",
  NO_SITE_INVENTORY: "CONFLICT",
  ASSET_NOT_FOUND: "NOT_FOUND",
  NO_BRIEF: "CONFLICT",
  NO_DRAFT: "CONFLICT",
  EVIDENCE_PACK_NOT_APPROVED: "CONFLICT",
};

/**
 * MCP tools pass module errors through `.catch(rethrowAsAppError)` so the
 * app-wide error handling recognises them. Content-factory services also raise
 * content-ops errors, so those are mapped here too.
 */
export function rethrowAsAppError(error: unknown): never {
  if (error instanceof ContentFactoryError) {
    throw new AppError(APP_ERROR_CODE_FOR[error.code], error.message);
  }
  return rethrowContentOpsAsAppError(error);
}
