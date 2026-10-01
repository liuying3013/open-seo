export const assetStatusLabels: Record<string, string> = {
  qa_review: "待审批",
  ready_to_publish: "已批准，待发布",
  drafted: "已退回，待修改",
  published: "已发布",
  indexed: "已收录",
  ranking: "排名中",
  optimize: "待优化",
  refresh: "待刷新",
};

export const checkLevelLabels = {
  blocking: "阻塞",
  warning: "警告",
  pass: "通过",
  unchecked: "未检查",
} as const;

export const checkLevelBadges = {
  blocking: "badge-error",
  warning: "badge-warning",
  pass: "badge-success",
  unchecked: "badge-ghost",
} as const;

// Display order: what needs attention first.
export const checkLevelOrder = [
  "blocking",
  "warning",
  "pass",
  "unchecked",
] as const;

export const checkIdLabels: Record<string, string> = {
  title_length: "标题长度",
  description_length: "描述长度",
  h1: "H1",
  heading_order: "标题层级",
  internal_links: "内部链接",
  image_alt: "图片 alt",
  prohibited_claims: "禁止声明",
  structured_data: "结构化数据",
  body: "正文",
  report: "检查报告",
};

export const attemptKindLabels: Record<string, string> = {
  publish: "发布",
  rollback: "回滚",
};

export const attemptStatusLabels: Record<string, string> = {
  queued: "排队中",
  publishing: "发布中",
  deploying: "部署中",
  verifying: "验收中",
  published: "已发布",
  failed: "失败",
  rolled_back: "已回滚",
  unverified: "未通过验收",
};

export const attemptStatusBadges: Record<string, string> = {
  queued: "badge-ghost",
  publishing: "badge-info",
  deploying: "badge-info",
  verifying: "badge-info",
  published: "badge-success",
  failed: "badge-error",
  rolled_back: "badge-neutral",
  unverified: "badge-warning",
};

export const errorStageLabels: Record<string, string> = {
  fingerprint: "指纹校验",
  merge: "合并",
  push: "推送",
  deploy: "部署",
  verify: "线上验收",
};

export const fileChangeLabels: Record<string, string> = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
};

export const fileChangeBadges: Record<string, string> = {
  added: "badge-success",
  modified: "badge-info",
  deleted: "badge-error",
};

export function formatTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

// Sessions only expose an opaque id; show a short form to tell people apart.
export function shortUserId(userId: string) {
  return userId.slice(0, 8);
}
