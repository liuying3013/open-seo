// Leaf error module (importable by tests without pulling heavy dependencies).
import { AppError } from "@/server/lib/errors";

type PagePlanErrorCode =
  | "SITE_PAGE_NOT_FOUND"
  | "CLUSTER_NOT_FOUND"
  | "PLAN_NOT_FOUND"
  | "PLAN_NOT_EDITABLE"
  | "INVALID_URL"
  | "INVALID_ITEM"
  | "LOGIN_REQUIRED";

export class PagePlanError extends Error {
  readonly code: PagePlanErrorCode;

  constructor(code: PagePlanErrorCode, message: string) {
    super(message);
    this.name = "PagePlanError";
    this.code = code;
  }
}

const APP_ERROR_CODE_FOR: Record<
  PagePlanErrorCode,
  ConstructorParameters<typeof AppError>[0]
> = {
  SITE_PAGE_NOT_FOUND: "NOT_FOUND",
  CLUSTER_NOT_FOUND: "NOT_FOUND",
  PLAN_NOT_FOUND: "NOT_FOUND",
  PLAN_NOT_EDITABLE: "CONFLICT",
  INVALID_URL: "VALIDATION_ERROR",
  INVALID_ITEM: "VALIDATION_ERROR",
  LOGIN_REQUIRED: "FORBIDDEN",
};

// Shown in the web app, which strips server errors to a bare code otherwise.
const WEB_MESSAGES: Record<PagePlanErrorCode, string> = {
  SITE_PAGE_NOT_FOUND: "页面不存在或不属于此项目，请刷新。",
  CLUSTER_NOT_FOUND: "选题不存在或不属于此项目，请刷新。",
  PLAN_NOT_FOUND: "找不到这份页面计划，请刷新。",
  PLAN_NOT_EDITABLE: "该计划已批准，不能再修改。",
  INVALID_URL: "有网址无法识别，请检查。",
  INVALID_ITEM: "计划条目不完整，请检查选题和目标页面。",
  LOGIN_REQUIRED: "只有登录用户可以批准计划。",
};

/**
 * Entry points (MCP tools, server functions) pass module errors through
 * `.catch(rethrowAsAppError)` so the app-wide error handling recognises them.
 * The message is kept for MCP clients.
 */
export function rethrowAsAppError(error: unknown): never {
  if (error instanceof PagePlanError) {
    throw new AppError(APP_ERROR_CODE_FOR[error.code], error.message);
  }
  throw error;
}

/** Server-function wrapper: module errors become a Chinese message for the UI. */
export async function pagePlanResult<T>(operation: () => Promise<T>) {
  try {
    return { ok: true as const, value: await operation() };
  } catch (error) {
    if (error instanceof PagePlanError) {
      return { ok: false as const, error: WEB_MESSAGES[error.code] };
    }
    throw error;
  }
}
