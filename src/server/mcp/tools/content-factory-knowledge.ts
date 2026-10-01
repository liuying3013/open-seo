import { z } from "zod";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { rethrowAsAppError } from "@/server/features/content-factory/contentFactoryErrors";
import { KnowledgeExtractionService } from "@/server/features/content-factory/services/KnowledgeExtractionService";
import { KnowledgeService } from "@/server/features/content-factory/services/KnowledgeService";
import { KnowledgeRepository } from "@/server/features/content-factory/repositories/KnowledgeRepository";
import {
  CLAIM_TYPES,
  KNOWLEDGE_CATEGORIES,
  SOURCE_QUALITIES,
} from "@/server/features/content-factory/rules/knowledgeRules";

export const addKnowledgeTool = {
  name: "add_knowledge",
  config: {
    title: "Record a fact the operator supplies",
    description:
      "Enter a product fact, business judgment or buyer question the business knows and no competitor page can tell us — SKU dimensions, bend radius, fire-test reports, warranty terms, MOQ, price bands. These are the questions evidence packs keep leaving open, and reading ranking pages cannot close them. Operator-supplied claims are approved on entry (the person reading the spec sheet IS the verification) and are exempt from the self-citation ban because their source is you, not our own published page. Use scope=internal for supplier cost, margin or customer identity — internal claims never reach a draft. Free.",
    inputSchema: {
      projectId: projectIdSchema,
      statement: z
        .string()
        .min(1)
        .describe("ONE assertion, specific enough to check later"),
      claimType: z.enum(CLAIM_TYPES),
      category: z.enum(KNOWLEDGE_CATEGORIES),
      scope: z.enum(["public", "internal"]),
      entity: z.string().optional(),
      applicability: z
        .string()
        .optional()
        .describe(
          "JSON of the conditions it holds under. Required for a number.",
        ),
      numericValue: z.number().optional(),
      numericUnit: z.string().optional(),
      sourceQuality: z.enum(SOURCE_QUALITIES).optional(),
      excerpt: z
        .string()
        .optional()
        .describe(
          "Where it came from: spec sheet, supplier confirmation, quote",
        ),
    },
    outputSchema: z.looseObject({
      knowledgeId: z.string(),
      created: z.boolean(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        statement: string;
        claimType: (typeof CLAIM_TYPES)[number];
        category: (typeof KNOWLEDGE_CATEGORIES)[number];
        scope: "public" | "internal";
        entity?: string;
        applicability?: string;
        numericValue?: number;
        numericUnit?: string;
        sourceQuality?: (typeof SOURCE_QUALITIES)[number];
        excerpt?: string;
      },
      context,
    ) => {
      const result =
        await KnowledgeService.addOperatorClaim(args).catch(rethrowAsAppError);
      return mcpResponse({
        text: result.created
          ? `Recorded and approved (${args.scope}). Drafts may ${args.scope === "public" ? "now cite it" : "NOT cite it — internal scope"}.`
          : "That statement is already recorded for this project; nothing was added.",
        structuredContent: result,
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/content-ops`,
        ),
      });
    },
  ),
};

export const extractKnowledgeDeltaTool = {
  name: "extract_knowledge_delta",
  config: {
    title: "Extract knowledge from a finished cluster",
    description:
      "Read a cluster's ranking-page bodies, evidence pack and brief, and record what the project now knows that it did not before. Claims are separated into fact / judgment / observation / hypothesis and land as CANDIDATES — nothing becomes usable knowledge until review_knowledge approves it. Unresolved contradictions are recorded rather than settled. 'Reused existing knowledge, added nothing' is a valid outcome and is logged as such. Uses 1 LLM budget unit.",
    inputSchema: {
      projectId: projectIdSchema,
      clusterId: z.string().min(1),
    },
    outputSchema: z.looseObject({
      reusedOnly: z.boolean(),
      added: z.number(),
      supported: z.number(),
      duplicates: z.number(),
      conflictsRecorded: z.number(),
      corrections: z.array(z.unknown()),
      newQuestions: z.array(z.string()),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; clusterId: string }, context) => {
      const result =
        await KnowledgeExtractionService.extractForCluster(args).catch(
          rethrowAsAppError,
        );
      const lines = [
        result.reusedOnly
          ? "No new knowledge — this task reused what the project already had."
          : `${result.added} new candidate claim(s).`,
        `${result.supported} existing claim(s) confirmed, ${result.duplicates} restatement(s) skipped.`,
        result.conflictsRecorded > 0
          ? `${result.conflictsRecorded} unresolved conflict(s) recorded; those entries are now needs_review.`
          : null,
        result.corrections.length > 0
          ? `${result.corrections.length} correction(s) proposed — review them with the user.`
          : null,
        result.newQuestions.length > 0
          ? `New questions: ${result.newQuestions.slice(0, 5).join("; ")}`
          : null,
        "Next: review_knowledge to approve or reject the candidates.",
      ].filter(Boolean);
      return mcpResponse({
        text: lines.join("\n"),
        structuredContent: result,
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/content-ops`,
        ),
      });
    },
  ),
};

type ReviewArgs = {
  projectId: string;
  knowledgeId: string;
  action: "approve" | "reject" | "needs_review" | "retract";
  reason?: string;
  supersededById?: string;
};

export const reviewKnowledgeTool = {
  name: "review_knowledge",
  config: {
    title: "Review a knowledge claim",
    description:
      "Approve, reject, flag or retract one knowledge claim. Approval enforces the self-citation ban: a FACT whose sources are all our own published content is refused, because that is the model citing itself one generation removed. Retracting looks up every asset that used the claim and reports them — knowledge and published pages must not drift apart silently.",
    inputSchema: {
      projectId: projectIdSchema,
      knowledgeId: z.string().min(1),
      action: z.enum(["approve", "reject", "needs_review", "retract"]),
      reason: z.string().optional(),
      supersededById: z
        .string()
        .optional()
        .describe("When retracting in favour of a corrected claim"),
    },
    outputSchema: z.looseObject({
      knowledgeId: z.string().optional(),
      status: z.string(),
      independentSources: z.number().optional(),
      affected: z.array(looseObjectOutputSchema).optional(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: ReviewArgs, context) => {
    const meta = buildProjectMeta(
      context,
      args.projectId,
      `/p/${args.projectId}/content-ops`,
    );
    if (args.action === "approve") {
      const result = await KnowledgeService.approve({
        projectId: args.projectId,
        knowledgeId: args.knowledgeId,
        approvedBy: "user",
      }).catch(rethrowAsAppError);
      return mcpResponse({
        text: `Approved. ${result.independentSources} independent source(s) back it.`,
        structuredContent: result,
        meta,
      });
    }
    if (args.action === "retract") {
      const result = await KnowledgeService.retract({
        projectId: args.projectId,
        knowledgeId: args.knowledgeId,
        reason: args.reason ?? "Retracted on review.",
        supersededById: args.supersededById,
        by: "user",
      }).catch(rethrowAsAppError);
      const affected = result.affected.length
        ? `\nAssets that used it and need review:\n${result.affected
            .map(
              (a) =>
                `- ${a.platform} (${a.status}) ${a.publishedUrl ?? a.assetId}`,
            )
            .join("\n")}`
        : "\nNo asset used it yet.";
      return mcpResponse({
        text: `Marked ${result.status}.${affected}`,
        structuredContent: result,
        meta,
      });
    }
    const result = await KnowledgeService.setStatus({
      projectId: args.projectId,
      knowledgeId: args.knowledgeId,
      status: args.action === "reject" ? "retracted" : "needs_review",
      by: "user",
    }).catch(rethrowAsAppError);
    return mcpResponse({
      text: `Marked ${result.status}.`,
      structuredContent: result,
      meta,
    });
  }),
};

export const listKnowledgeTool = {
  name: "list_knowledge",
  config: {
    title: "List project knowledge",
    description:
      "The project's accumulated claims, with their epistemic status. Default shows what still needs a human decision (candidates and disputed entries). Use status=approved to see what a draft may actually cite — only approved AND public claims are usable in writing.",
    inputSchema: {
      projectId: projectIdSchema,
      status: z
        .enum([
          "candidate",
          "approved",
          "needs_review",
          "superseded",
          "retracted",
        ])
        .optional()
        .describe("Default: candidates and needs_review together"),
      entity: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    outputSchema: z.looseObject({
      entries: z.array(looseObjectOutputSchema),
      openConflicts: z.number(),
      ...optionalMetaOutputSchema,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        status?:
          | "candidate"
          | "approved"
          | "needs_review"
          | "superseded"
          | "retracted";
        entity?: string;
        limit?: number;
      },
      context,
    ) => {
      const entries = args.status
        ? await KnowledgeRepository.listByProject({
            projectId: args.projectId,
            status: args.status,
            entity: args.entity,
            limit: args.limit,
          })
        : await KnowledgeRepository.listPendingReview(
            args.projectId,
            args.limit,
          );
      const sourcesById = await KnowledgeRepository.listSourcesFor(
        entries.map((e) => e.id),
      );
      const rows = entries.map((entry) => ({
        id: entry.id,
        claimType: entry.claimType,
        category: entry.category,
        statement: entry.statement,
        entity: entry.entity,
        status: entry.status,
        scope: entry.scope,
        sourceCount: sourcesById.get(entry.id)?.length ?? 0,
        recheckAfter: entry.recheckAfter,
      }));
      const conflicts = await KnowledgeRepository.listOpenConflicts(
        args.projectId,
      );
      return mcpResponse({
        text:
          rows.length === 0
            ? "No knowledge entries match."
            : `${rows.length} entr(ies)${conflicts.length ? `, ${conflicts.length} open conflict(s)` : ""}:\n` +
              rows
                .map(
                  (r) =>
                    `- [${r.claimType}/${r.scope}] ${r.statement} (${r.sourceCount} source(s), ${r.status})`,
                )
                .join("\n"),
        structuredContent: { entries: rows, openConflicts: conflicts.length },
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/content-ops`,
        ),
      });
    },
  ),
};
