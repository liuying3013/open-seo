import type { getContentWorkbench, getWorkbenchTopic } from "./workbenchApi";
export type WorkbenchOverview = Awaited<ReturnType<typeof getContentWorkbench>>;
export type WorkbenchTopic = Awaited<ReturnType<typeof getWorkbenchTopic>>;
export type WorkbenchAsset = WorkbenchTopic["assets"][number];
export const clusterLabels: Record<string, string> = {
  new: "待预筛",
  pre_scored: "待研究",
  serp_pending: "研究中",
  serp_ready: "待分析评分",
  scored: "待决策审核",
  decided: "取材与写作",
  brief_ready: "内容生产",
  on_hold: "已暂停",
  archived: "已归档",
};
export const assetLabels: Record<string, string> = {
  planned: "待写作提纲",
  brief_ready: "待生成文章",
  drafted: "待 QA",
  qa_review: "待修改审核",
  ready_to_publish: "QA 已通过",
  published: "已发布",
  rejected: "已拒绝",
  indexed: "已收录",
  ranking: "排名中",
  retired: "已停用",
};
export const jobLabels: Record<string, string> = {
  learn: "了解知识",
  compare: "比较方案",
  choose: "选型决策",
  source: "寻找供应商",
  troubleshoot: "解决故障",
  verify: "核实信息",
  buy: "购买采购",
};

export type WorkbenchTask = { label: string; run: () => Promise<unknown> };
export type WorkbenchAction = (
  label: string,
  action: "analyze" | "decide" | "read_pages" | "build_pack",
  ai?: boolean,
) => void;
