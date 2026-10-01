// Vocabulary shared by the page-publishing schemas, services and MCP tools.

export const PAGE_ACTIONS = [
  "new",
  "update",
  "add_section",
  "merge",
  "watch",
  "exclude",
] as const;

export const VERSION_FILE_CHANGES = ["added", "modified", "deleted"] as const;
export const VERSION_AUTHORS = ["agent", "user"] as const;
export const APPROVAL_DECISIONS = ["approved", "rejected"] as const;
export const PUBLISH_ATTEMPT_KINDS = ["publish", "rollback"] as const;
export const PUBLISH_ATTEMPT_STATUSES = [
  "queued",
  "publishing",
  "deploying",
  "verifying",
  "published",
  "failed",
  "rolled_back",
  "unverified",
] as const;
export const PUBLISH_ERROR_STAGES = [
  "fingerprint",
  "merge",
  "push",
  "deploy",
  "verify",
] as const;

// Live verification: the share of the approved text that must be found on the
// published page (0-100) before the server accepts it as published.
export const PUBLISH_TEXT_MATCH_THRESHOLD = 85;

// Work order statuses after a successful publish.
export const PUBLISHED_ASSET_STATUSES = [
  "published",
  "indexed",
  "ranking",
  "optimize",
  "refresh",
] as const;
