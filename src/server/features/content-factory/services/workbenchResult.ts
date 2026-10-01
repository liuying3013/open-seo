import { ContentOpsError } from "@/server/features/content-ops/contentOpsErrors";
import { ContentFactoryError } from "../contentFactoryErrors";

const messages: Record<string, string> = {
  BUDGET_EXCEEDED: "今日项目预算已用尽，请调整预算或明天继续。",
  KEYWORDS_ALREADY_CLUSTERED: "有关键词已归属其他选题，请移除重复词后保存。",
  KEYWORDS_NOT_FOUND: "候选词不存在或已被分组，请刷新后重新选择。",
  CLUSTER_NOT_FOUND: "找不到此项目的选题。",
  OFFER_NOT_FOUND: "产品不属于此项目，请重新选择。",
  INVALID_STATUS_TRANSITION:
    "内容状态或版本已变化。请先保留未保存的修改，刷新后再继续。",
  DISAMBIGUATION_REQUIRED:
    "此品类含义尚未明确，请先在项目设置中补充品类定义，再分析搜索结果。",
  SERP_NOT_READY:
    "搜索数据、代表词或选题状态已变化。请刷新，重新分析或确认抓取范围。",
  RANKING_PAGES_NOT_READ: "还没有读取排名页正文，请先取材再生成证据包。",
  EVIDENCE_PACK_NOT_FOUND: "请先生成并批准证据包。",
  EVIDENCE_PACK_NOT_APPROVED: "请先批准当前证据包。",
  ASSET_NOT_FOUND: "文章不存在或不属于此项目。",
  DECISION_NOT_FOUND: "内容方案不存在，请刷新。",
  DECISION_NOT_APPROVED: "请先批准内容部署方案。",
  NO_PAGES_TO_READ: "没有可读取的排名页，请检查搜索证据。",
  NO_BRIEF: "请先生成写作提纲。",
  NO_DRAFT: "请先生成文章。",
  LLM_OUTPUT_INVALID:
    "AI 未返回有效结果。可能已产生调用费用；请检查模型配置与操作记录，再决定是否重试。",
};
export async function workbenchResult<T>(operation: () => Promise<T>) {
  try {
    return { ok: true as const, value: await operation() };
  } catch (error) {
    if (
      error instanceof ContentOpsError ||
      error instanceof ContentFactoryError
    ) {
      return {
        ok: false as const,
        error: messages[error.code] ?? "此步骤无法完成，请检查输入和当前阶段。",
      };
    }
    throw error;
  }
}
