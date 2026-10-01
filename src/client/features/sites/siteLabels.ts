import type {
  SITE_CONTENT_FORMATS,
  SITE_HOSTINGS,
  SITE_OPS_STATUSES,
  SITE_ROLES,
  SITE_TEMPLATE_FAMILIES,
} from "@/shared/siteRegistry";

export const UNKNOWN_LABEL = "未接入 / 未知";

export const ROLE_LABELS: Record<(typeof SITE_ROLES)[number], string> = {
  brand_main: "品牌主站",
  topical: "垂直站",
  research: "研究站",
  other: "其他",
};

export const STATUS_LABELS: Record<(typeof SITE_OPS_STATUSES)[number], string> =
  {
    pending: "待接入",
    active: "运营中",
    focus: "重点",
    maintenance: "维护",
    paused: "暂停",
  };

export const STATUS_BADGES: Record<(typeof SITE_OPS_STATUSES)[number], string> =
  {
    pending: "badge-ghost",
    active: "badge-success",
    focus: "badge-primary",
    maintenance: "badge-warning",
    paused: "badge-neutral",
  };

export const HOSTING_LABELS: Record<(typeof SITE_HOSTINGS)[number], string> = {
  coolify: "Coolify",
  external: "外部托管",
  unknown: UNKNOWN_LABEL,
};

export const TEMPLATE_LABELS: Record<
  (typeof SITE_TEMPLATE_FAMILIES)[number],
  string
> = {
  tanstack: "TanStack",
  astro: "Astro",
  blog: "Blog",
  nextjs_sanity: "Next.js + Sanity",
  other: "其他",
};

export const CONTENT_FORMAT_LABELS: Record<
  (typeof SITE_CONTENT_FORMATS)[number],
  string
> = {
  mdx: "MDX",
  tsx: "TSX",
  mixed: "混合",
  cms: "CMS",
  unknown: UNKNOWN_LABEL,
};
