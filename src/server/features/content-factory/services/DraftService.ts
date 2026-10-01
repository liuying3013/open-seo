import { ContentOpsError } from "@/server/features/content-ops/contentOpsErrors";
import { z } from "zod";
import { AssetsRepository } from "@/server/features/content-ops/repositories/AssetsRepository";
import { EvidencePacksRepository } from "@/server/features/content-ops/repositories/EvidencePacksRepository";
import { DecisionLogRepository } from "@/server/features/content-ops/repositories/DecisionLogRepository";
import { runStructuredLlm } from "@/server/features/content-ops/services/llm";
import { assertAssetTransition } from "@/server/features/content-ops/stateMachine";
import { ContentFactoryError } from "../contentFactoryErrors";
import { KnowledgeService } from "./KnowledgeService";
import { ContextPackService } from "./ContextPackService";
import {
  GENERATE_DRAFT_PROMPT_VERSION,
  GENERATE_DRAFT_SYSTEM,
  buildDraftPrompt,
  draftSchema,
} from "../prompts/generateDraft";
import {
  QA_DRAFT_PROMPT_VERSION,
  QA_DRAFT_SYSTEM,
  buildQaPrompt,
  qaReportSchema,
} from "../prompts/qaDraft";
import {
  explainVerdict,
  MAX_AUTO_FIX_ROUNDS,
  QA_RULE_VERSION,
  verdictFor,
  type QaFinding,
} from "../rules/qaRules";

// specs/0013 section 7: turn an approved pack and brief into a page, then judge
// it independently.
//
// The draft's inputs are exactly the four the spec names — project rules,
// selected prior knowledge, the research pack, and the final brief — and
// nothing else. Whatever the model knows from pre-training is not evidence
// about this business.

function claimStatements(entries: Array<{ statement: string }>): string[] {
  return entries.map((entry) => entry.statement);
}

// The pack is stored as JSON text; only prohibitedClaims is needed here, and a
// pack written by an older prompt version may not have it.
const packClaimsSchema = z.object({
  prohibitedClaims: z.array(z.string()).default([]),
});

function parsePackClaims(packContent: string | null): {
  prohibited: string[];
} {
  if (!packContent) return { prohibited: [] };
  try {
    const parsed = packClaimsSchema.safeParse(JSON.parse(packContent));
    return { prohibited: parsed.success ? parsed.data.prohibitedClaims : [] };
  } catch {
    return { prohibited: [] };
  }
}

async function gather(input: { projectId: string; assetId: string }) {
  const asset = await AssetsRepository.getById(input.projectId, input.assetId);
  if (!asset) {
    throw new ContentFactoryError("ASSET_NOT_FOUND", "Asset not found.");
  }
  if (!asset.brief) {
    throw new ContentFactoryError(
      "NO_BRIEF",
      "This asset has no brief yet. Run generate_brief first — a draft without one has nothing to be measured against.",
      { assetId: input.assetId },
    );
  }
  const pack = await EvidencePacksRepository.getLatestForCluster(
    asset.clusterId,
  );
  if (!pack || pack.status !== "approved") {
    throw new ContentFactoryError(
      "EVIDENCE_PACK_NOT_APPROVED",
      "The cluster's evidence pack is not approved. Approve it before drafting — the pack is what the draft's facts are checked against.",
      { clusterId: asset.clusterId },
    );
  }
  const [context, knowledge] = await Promise.all([
    ContextPackService.buildForCluster({
      projectId: input.projectId,
      clusterId: asset.clusterId,
    }),
    KnowledgeService.listForWriting({ projectId: input.projectId }),
  ]);
  const contextRules = JSON.stringify(context.rules, null, 2);
  return { asset, pack, context, knowledge, contextRules };
}

async function generate(input: { projectId: string; assetId: string }) {
  const { asset, pack, context, knowledge, contextRules } = await gather(input);
  assertAssetTransition(asset.status, "drafted");

  const { object: draft, model } = await runStructuredLlm({
    projectId: input.projectId,
    schema: draftSchema,
    system: GENERATE_DRAFT_SYSTEM,
    prompt: buildDraftPrompt({
      brief: asset.brief ?? "",
      evidencePack: pack.content,
      contextRules,
      knownClaims: claimStatements(knowledge.fresh),
      openQuestions: context.openQuestions,
      internalLinkCandidates: context.coveringPages.map((page) => ({
        url: page.url,
        topic: page.topic,
      })),
      writingPreferences: context.rules.writingPreferences,
    }),
  });

  const saved = await AssetsRepository.saveDraft({
    projectId: input.projectId,
    assetId: input.assetId,
    draft: JSON.stringify(draft),
    status: "drafted",
    qaReport: null,
    expected: {
      draft: asset.draft,
      status: asset.status,
      updatedAt: asset.updatedAt,
    },
  });
  if (!saved)
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      "文章已被其他操作修改，请刷新后重试。",
    );
  await DecisionLogRepository.append({
    projectId: input.projectId,
    clusterId: asset.clusterId,
    decisionType: "other",
    inputSnapshot: JSON.stringify({
      stage: "draft",
      assetId: input.assetId,
      packVersion: pack.version,
      knowledgeUsed: draft.claimsUsed.length,
    }),
    decision: JSON.stringify({ title: draft.title, slug: draft.slug }),
    reasonSummary: `Draft written for ${asset.platform}: ${draft.addedValue}`,
    model,
    promptVersion: GENERATE_DRAFT_PROMPT_VERSION,
    createdBy: "agent",
  });
  return { assetId: input.assetId, draft };
}

/**
 * Independent QA, with the auto-fix loop capped. The rewrite is only attempted
 * for findings a rewrite can actually address; grounding, boundary and
 * duplication problems go straight to a human, because asking a model to "fix"
 * an unsourced claim is asking it to invent a source.
 */
async function runQa(input: { projectId: string; assetId: string }) {
  const { asset, pack, context, knowledge, contextRules } = await gather(input);
  if (!["drafted", "qa_review", "ready_to_publish"].includes(asset.status)) {
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      "当前文章状态不能执行 QA。",
    );
  }
  if (!asset.draft) {
    throw new ContentFactoryError(
      "NO_DRAFT",
      "This asset has no draft to review. Run generate_draft first.",
      { assetId: input.assetId },
    );
  }
  const { prohibited } = parsePackClaims(pack.content);
  const knownClaims = claimStatements(knowledge.fresh);
  const ourPages = context.coveringPages.map((page) => page.url);

  let currentDraft = asset.draft;
  let roundsUsed = 0;
  let findings: QaFinding[] = [];
  let verdict = "pass" as ReturnType<typeof verdictFor>;
  let model: string | null = null;

  for (;;) {
    const { object: report, model: usedModel } = await runStructuredLlm({
      projectId: input.projectId,
      schema: qaReportSchema,
      system: QA_DRAFT_SYSTEM,
      prompt: buildQaPrompt({
        draft: currentDraft,
        evidencePack: pack.content,
        contextRules,
        knownClaims,
        prohibitedClaims: prohibited,
        ourExistingPages: ourPages,
      }),
    });
    model = usedModel;
    findings = report.findings;
    verdict = verdictFor({ findings, roundsUsed });
    if (verdict !== "auto_fix") break;

    roundsUsed += 1;
    const { object: revised } = await runStructuredLlm({
      projectId: input.projectId,
      schema: draftSchema,
      system: GENERATE_DRAFT_SYSTEM,
      prompt:
        buildDraftPrompt({
          brief: asset.brief ?? "",
          evidencePack: pack.content,
          contextRules,
          knownClaims,
          openQuestions: context.openQuestions,
          internalLinkCandidates: context.coveringPages.map((page) => ({
            url: page.url,
            topic: page.topic,
          })),
          writingPreferences: context.rules.writingPreferences,
        }) +
        `\n\nCURRENT DRAFT:\n${currentDraft}\n\nTHIS IS A REVISION. Fix exactly these findings and change nothing else:\n${findings
          .map((f) => `- [${f.dimension}] ${f.detail}`)
          .join("\n")}`,
    });
    currentDraft = JSON.stringify(revised);
  }

  const explanation = explainVerdict({ verdict, findings, roundsUsed });
  const qaReport = {
    verdict,
    roundsUsed,
    findings,
    explanation,
    ruleVersion: QA_RULE_VERSION,
    maxAutoFixRounds: MAX_AUTO_FIX_ROUNDS,
  };
  // A passing draft moves on; anything else waits for a person. The asset never
  // skips qa_review on its own.
  const saved = await AssetsRepository.saveDraft({
    projectId: input.projectId,
    assetId: input.assetId,
    draft: currentDraft,
    status: verdict === "pass" ? "ready_to_publish" : "qa_review",
    qaReport: JSON.stringify(qaReport),
    expected: {
      draft: asset.draft,
      status: asset.status,
      updatedAt: asset.updatedAt,
    },
  });
  if (!saved)
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      "审核期间文章已变化，未覆盖新版本，请重新执行 QA。",
    );
  await DecisionLogRepository.append({
    projectId: input.projectId,
    clusterId: asset.clusterId,
    decisionType: "other",
    inputSnapshot: JSON.stringify({
      stage: "qa",
      assetId: input.assetId,
      roundsUsed,
    }),
    decision: JSON.stringify(qaReport),
    reasonSummary: explanation,
    model,
    promptVersion: QA_DRAFT_PROMPT_VERSION,
    ruleVersion: QA_RULE_VERSION,
    createdBy: "agent",
  });
  return { assetId: input.assetId, ...qaReport };
}

async function saveEdited(input: {
  projectId: string;
  assetId: string;
  expectedDraft: string;
  draft: z.infer<typeof draftSchema>;
}) {
  const asset = await AssetsRepository.getById(input.projectId, input.assetId);
  if (!asset)
    throw new ContentFactoryError(
      "ASSET_NOT_FOUND",
      "文章不存在或不属于此项目。",
    );
  if (
    !asset.draft ||
    !["drafted", "qa_review", "ready_to_publish"].includes(asset.status)
  ) {
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      "只能编辑尚未发布的草稿。",
    );
  }
  if (asset.draft !== input.expectedDraft)
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      "文章已更新，请重新加载后合并你的修改。",
    );
  const draft = draftSchema.parse(input.draft);
  const saved = await AssetsRepository.saveDraft({
    projectId: input.projectId,
    assetId: input.assetId,
    draft: JSON.stringify(draft),
    status: "qa_review",
    qaReport: null,
    expected: {
      draft: asset.draft,
      status: asset.status,
      updatedAt: asset.updatedAt,
    },
  });
  if (!saved)
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      "文章已更新，未覆盖其他人的修改。",
    );
  await DecisionLogRepository.append({
    projectId: input.projectId,
    clusterId: asset.clusterId,
    decisionType: "other",
    decision: JSON.stringify({ stage: "manual_edit", assetId: asset.id }),
    reasonSummary: "人工保存文章；旧 QA 结果已清除，需重新审核。",
    createdBy: "user",
  });
  return { assetId: asset.id };
}

export const DraftService = {
  saveEdited,
  generate,
  runQa,
};
