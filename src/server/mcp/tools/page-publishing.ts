import { z } from "zod";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { rethrowAsAppError } from "@/server/features/content-ops/contentOpsErrors";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { contentDraftSchema } from "@/server/features/page-publishing/rules/contentChecks";
import { ContentVersionService } from "@/server/features/page-publishing/services/ContentVersionService";
import {
  ATTEMPT_STATUS_INPUTS,
  PublishService,
} from "@/server/features/page-publishing/services/PublishService";
import { SiteChangeAlertService } from "@/server/features/page-publishing/services/SiteChangeAlertService";
import {
  PUBLISH_ERROR_STAGES,
  VERSION_FILE_CHANGES,
} from "@/shared/pagePublishing";

// Tools for the writing agent and the host-side publisher (API key auth).
// Approving, rejecting, revoking approvals and requesting rollbacks are not
// tools on purpose: those are session-only decisions made in the web app.

const MAX_PNG_BASE64_CHARS = 4_300_000; // ~3MB decoded

const projectLink = (projectId: string) => `/p/${projectId}/publishing`;

const writeAnnotations = {
  readOnlyHint: false,
  openWorldHint: false,
  destructiveHint: false,
} as const;

type SubmitArgs = {
  projectId: string;
  assetId: string;
  draft: z.infer<typeof contentDraftSchema>;
  implementation: {
    taskBranch: string;
    baseCommit: string;
    headCommit: string;
    patchId: string;
    diffText: string;
    files: Array<{
      path: string;
      change: (typeof VERSION_FILE_CHANGES)[number];
    }>;
  };
  reviewerNotes?: string;
};

export const submitContentVersionTool = {
  name: "submit_content_version",
  config: {
    title: "Submit page content version",
    description:
      "Submit a new content version for a page work order (a money_site content asset): the structured draft plus the implementation in the site repository's task branch (commits, patch id, diff, changed files). The server runs deterministic checks (title/description length, headings, alt text, prohibited claims, structured data) and moves the work order to qa_review. Any earlier approval stops being valid. Approval is a human step in the web app. Returns the new version number and the check results (pass / warning / blocking / unchecked).",
    inputSchema: {
      projectId: projectIdSchema,
      assetId: z.string().min(1).describe("The page work order's asset id."),
      draft: contentDraftSchema,
      implementation: z.object({
        taskBranch: z.string().min(1),
        baseCommit: z.string().min(7).max(64),
        headCommit: z.string().min(7).max(64),
        patchId: z
          .string()
          .min(7)
          .max(64)
          .describe(
            "`git diff --binary -U0 origin/<production-branch>...HEAD | git patch-id --stable` of the task branch (first column). The publisher re-computes it before publishing.",
          ),
        diffText: z
          .string()
          .max(2_000_000)
          .describe("Unified diff; stored truncated to 256KB."),
        files: z
          .array(
            z.object({
              path: z.string().min(1).max(500),
              change: z.enum(VERSION_FILE_CHANGES),
            }),
          )
          .max(500),
      }),
      reviewerNotes: z
        .string()
        .max(4000)
        .optional()
        .describe(
          "Facts or choices the human reviewer should confirm before approving. Shown as a comment on the review page.",
        ),
    },
    outputSchema: z.looseObject({
      versionId: z.string(),
      version: z.number(),
      status: z.string(),
      checks: z.looseObject({
        blocking: z.number(),
        warnings: z.number(),
        checks: z.array(looseObjectOutputSchema),
      }),
      ...optionalMetaOutputSchema,
    }),
    annotations: writeAnnotations,
  },
  handler: withMcpProjectAuth(async (args: SubmitArgs, context) => {
    const result =
      await ContentVersionService.submit(args).catch(rethrowAsAppError);
    return mcpResponse({
      text: `Version ${result.version} submitted; work order is in qa_review. Checks: ${result.checks.blocking} blocking, ${result.checks.warnings} warnings.\n${result.checks.checks
        .map((check) => `- ${check.id}: ${check.level} - ${check.message}`)
        .join("\n")}`,
      structuredContent: result,
      meta: buildProjectMeta(
        context,
        args.projectId,
        projectLink(args.projectId),
      ),
    });
  }),
};

export const listPublishQueueTool = {
  name: "list_publish_queue",
  config: {
    title: "List publish queue",
    description:
      "For one project: work orders whose approval is valid (current version, not revoked) and whose publish time has come, plus queued rollback requests. Each publish item carries the approved patch id, task branch and commits, the approved draft (for live text comparison), target_url, language, and any in-flight attempt; `site` holds the repo, production branch, auto_deploy, Coolify app uuid and domain from the site registry.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: z.looseObject({
      site: looseObjectOutputSchema.nullable(),
      publish: z.array(looseObjectOutputSchema),
      rollbacks: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const queue = await PublishService.getQueue(args.projectId);
    return mcpResponse({
      text: `${queue.publish.length} approved page(s) due, ${queue.rollbacks.length} rollback request(s).`,
      structuredContent: queue,
      meta: buildProjectMeta(
        context,
        args.projectId,
        projectLink(args.projectId),
      ),
    });
  }),
};

type RecordArgs = {
  projectId: string;
  attemptId?: string;
  assetId?: string;
  approvalId?: string;
  status: (typeof ATTEMPT_STATUS_INPUTS)[number];
  mergeCommit?: string;
  coolifyDeploymentUuid?: string;
  liveStatusCode?: number;
  textMatch?: number;
  liveCheck?: { noindex: boolean; canonical?: string | null; notes?: string };
  publishedUrl?: string;
  errorStage?: (typeof PUBLISH_ERROR_STAGES)[number];
  errorMessage?: string;
  screenshotDesktopPngBase64?: string;
  screenshotMobilePngBase64?: string;
};

export const recordPublishAttemptTool = {
  name: "record_publish_attempt",
  config: {
    title: "Record publish attempt",
    description:
      "Create or update one publish/rollback attempt. Start a publish attempt with assetId + approvalId (from list_publish_queue); continue or finish it with attemptId (a rollback request's attemptId comes from the queue). Report progress statuses (publishing, deploying, verifying) and the live check. Reporting `published` is only accepted when the live page returned 200, is not noindex and the text match is at least 85; otherwise the attempt is stored as `unverified`. Use status `failed` with errorStage `fingerprint` when the rebuilt patch id differs from the approved one: the approval is voided and the work order returns to qa_review. A rollback ends with `rolled_back`. Screenshots are base64 PNG, at most 3MB each.",
    inputSchema: {
      projectId: projectIdSchema,
      attemptId: z.string().min(1).optional(),
      assetId: z.string().min(1).optional(),
      approvalId: z.string().min(1).optional(),
      status: z.enum(ATTEMPT_STATUS_INPUTS),
      mergeCommit: z.string().min(7).max(64).optional(),
      coolifyDeploymentUuid: z.string().min(1).optional(),
      liveStatusCode: z.number().int().min(100).max(599).optional(),
      textMatch: z.number().min(0).max(100).optional(),
      liveCheck: z
        .object({
          noindex: z.boolean(),
          canonical: z.string().nullable().optional(),
          notes: z.string().max(2000).optional(),
        })
        .optional(),
      publishedUrl: z.string().url().optional(),
      errorStage: z.enum(PUBLISH_ERROR_STAGES).optional(),
      errorMessage: z.string().max(4000).optional(),
      screenshotDesktopPngBase64: z
        .string()
        .max(MAX_PNG_BASE64_CHARS)
        .optional(),
      screenshotMobilePngBase64: z
        .string()
        .max(MAX_PNG_BASE64_CHARS)
        .optional(),
    },
    outputSchema: z.looseObject({
      attemptId: z.string(),
      status: z.string(),
      reason: z.string().nullable(),
      ...optionalMetaOutputSchema,
    }),
    annotations: writeAnnotations,
  },
  handler: withMcpProjectAuth(async (args: RecordArgs, context) => {
    const result =
      await PublishService.recordAttempt(args).catch(rethrowAsAppError);
    return mcpResponse({
      text: `Attempt ${result.attemptId} is ${result.status}${result.reason ? `: ${result.reason}` : "."}`,
      structuredContent: result,
      meta: buildProjectMeta(
        context,
        args.projectId,
        projectLink(args.projectId),
      ),
    });
  }),
};

type ReportChangesArgs = {
  projectId: string;
  commits: Array<{ sha: string; author?: string; message?: string }>;
};

export const reportSiteChangesTool = {
  name: "report_site_changes",
  config: {
    title: "Report unapproved site changes",
    description:
      "Report commits on a project's production branch that were not published through an approved work order. Idempotent per commit sha: already-known commits are ignored. Raises an alert in the web app until a person resolves it.",
    inputSchema: {
      projectId: projectIdSchema,
      commits: z
        .array(
          z.object({
            sha: z.string().min(7).max(64),
            author: z.string().max(200).optional(),
            message: z.string().max(1000).optional(),
          }),
        )
        .min(1)
        .max(200),
    },
    outputSchema: z.looseObject({
      inserted: z.number(),
      alreadyKnown: z.number(),
      ...optionalMetaOutputSchema,
    }),
    annotations: { ...writeAnnotations, idempotentHint: true },
  },
  handler: withMcpProjectAuth(async (args: ReportChangesArgs, context) => {
    const result = await SiteChangeAlertService.report(args);
    return mcpResponse({
      text: `${result.inserted} new alert(s), ${result.alreadyKnown} already known.`,
      structuredContent: result,
      meta: buildProjectMeta(
        context,
        args.projectId,
        projectLink(args.projectId),
      ),
    });
  }),
};
