import { z } from "zod";

// Inputs of the page-publishing server functions. projectId is read by the
// auth middleware; resource ids are always re-checked against it.

const projectId = z.string().min(1);
const assetId = z.string().min(1);

export const pageReviewProjectSchema = z.object({ projectId });

export const pageReviewAssetSchema = z.object({ projectId, assetId });

export const approvePageVersionSchema = z.object({
  projectId,
  assetId,
  versionId: z.string().min(1),
  // ISO date-time; omitted = publish as soon as possible.
  publishAt: z.string().min(1).optional(),
  comment: z.string().max(2000).optional(),
});

export const rejectPageVersionSchema = z.object({
  projectId,
  assetId,
  versionId: z.string().min(1),
  comment: z.string().trim().min(1).max(2000),
});

export const commentOnPageSchema = z.object({
  projectId,
  assetId,
  body: z.string().trim().min(1).max(4000),
});

export const publishScreenshotSchema = z.object({
  projectId,
  attemptId: z.string().min(1),
  kind: z.enum(["desktop", "mobile"]),
});

export const resolveSiteAlertSchema = z.object({
  projectId,
  alertId: z.string().min(1),
});
