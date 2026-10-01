import { z } from "zod";

// Deterministic pre-publish checks on a content draft. Pure: callers pass the
// facts the checks need (prohibited claims from the evidence pack, the site's
// known page URLs) so the rules stay testable and free of I/O.

export const contentDraftSchema = z.object({
  title: z.string(),
  metaDescription: z.string(),
  slug: z.string(),
  // Markdown. The page title is rendered as the H1 by the site template.
  body: z.string(),
  language: z.string().min(1).optional(),
  internalLinkTargets: z
    .array(
      z.object({
        url: z.string(),
        anchor: z.string().optional(),
        why: z.string().optional(),
      }),
    )
    .default([]),
  imageBriefs: z.array(z.string()).default([]),
  cta: z.string().default(""),
  structuredDataType: z.string().nullable().default(null),
  claimsUsed: z.array(z.string()).default([]),
  addedValue: z.string().optional(),
});
export type ContentDraft = z.infer<typeof contentDraftSchema>;

/** Stored drafts are JSON text; anything unreadable is null. */
export function parseStoredDraft(json: string): ContentDraft | null {
  try {
    const parsed = contentDraftSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

type CheckLevel = "pass" | "warning" | "blocking" | "unchecked";

type CheckResult = {
  id: string;
  level: CheckLevel;
  message: string;
};

type ChecksReport = {
  checks: CheckResult[];
  blocking: number;
  warnings: number;
};

type CheckContext = {
  prohibitedClaims?: readonly string[] | null;
  // Extension point for the site page inventory: absolute or root-relative
  // URLs known to exist on the site. Undefined = not available, and the
  // internal-link check reports "unchecked".
  knownPageUrls?: ReadonlySet<string> | null;
};

const TITLE_RANGE = [30, 65] as const;
const DESCRIPTION_RANGE = [70, 160] as const;

function stripCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
}

function headingLevels(markdown: string): number[] {
  return [...stripCode(markdown).matchAll(/^(#{1,6})\s+\S/gm)].map(
    (match) => match[1].length,
  );
}

function lengthCheck(
  id: string,
  label: string,
  value: string,
  [min, max]: readonly [number, number],
): CheckResult {
  const length = value.trim().length;
  if (length === 0) {
    return { id, level: "blocking", message: `${label}为空。` };
  }
  if (length < min || length > max) {
    return {
      id,
      level: "warning",
      message: `${label}长 ${length} 个字符，建议 ${min}–${max}。`,
    };
  }
  return { id, level: "pass", message: `${label}长 ${length} 个字符。` };
}

function h1Check(body: string): CheckResult {
  const h1Count = headingLevels(body).filter((level) => level === 1).length;
  if (h1Count === 0) {
    return {
      id: "h1",
      level: "pass",
      message: "标题是唯一的 H1。",
    };
  }
  if (h1Count === 1) {
    return {
      id: "h1",
      level: "warning",
      message: "正文里还有一个 H1；除非模板不渲染标题，页面会有两个 H1。",
    };
  }
  return {
    id: "h1",
    level: "blocking",
    message: `正文有 ${h1Count} 个 H1，一个页面只能有一个。`,
  };
}

function headingOrderCheck(body: string): CheckResult {
  const levels = headingLevels(body);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) {
      return {
        id: "heading_order",
        level: "warning",
        message: `标题层级从 H${levels[i - 1]} 跳到了 H${levels[i]}。`,
      };
    }
  }
  const first = levels[0];
  // The title is the H1, so the first body heading should be an H2.
  if (first !== undefined && first > 2) {
    return {
      id: "heading_order",
      level: "warning",
      message: `正文第一个小标题是 H${first}，应为 H2。`,
    };
  }
  return {
    id: "heading_order",
    level: "pass",
    message: "标题层级没有跳级。",
  };
}

function bodyLinks(body: string): string[] {
  return [...stripCode(body).matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)/g)].map(
    (match) => match[1],
  );
}

function internalLinkCheck(draft: ContentDraft, context: CheckContext) {
  if (!context.knownPageUrls) {
    return {
      id: "internal_links",
      level: "unchecked",
      message: "该站点的页面清单还没导入，无法检查内部链接。",
    } satisfies CheckResult;
  }
  const known = context.knownPageUrls;
  const urls = new Set([
    ...draft.internalLinkTargets.map((target) => target.url),
    ...bodyLinks(draft.body).filter((url) => url.startsWith("/")),
  ]);
  const missing = [...urls].filter((url) => !known.has(url));
  return missing.length === 0
    ? ({
        id: "internal_links",
        level: "pass",
        message: `${urls.size} 个内部链接都指向站内现有页面。`,
      } satisfies CheckResult)
    : ({
        id: "internal_links",
        level: "warning",
        message: `这些内部链接在站内找不到：${missing.join("、")}。`,
      } satisfies CheckResult);
}

function imageAltCheck(body: string): CheckResult {
  const text = stripCode(body);
  const markdownImages = [...text.matchAll(/!\[([^\]]*)\]\([^)]*\)/g)];
  const htmlImages = [...text.matchAll(/<img\b[^>]*>/gi)];
  const missing =
    markdownImages.filter((match) => match[1].trim() === "").length +
    htmlImages.filter((match) => !/\balt\s*=\s*["'][^"']+["']/i.test(match[0]))
      .length;
  const total = markdownImages.length + htmlImages.length;
  if (missing > 0) {
    return {
      id: "image_alt",
      level: "warning",
      message: `${total} 张图片中有 ${missing} 张缺少 alt 文字。`,
    };
  }
  return {
    id: "image_alt",
    level: "pass",
    message: total === 0 ? "正文没有图片。" : "所有图片都有 alt 文字。",
  };
}

function prohibitedClaimsCheck(draft: ContentDraft, context: CheckContext) {
  const claims = context.prohibitedClaims;
  if (!claims) {
    return {
      id: "prohibited_claims",
      level: "unchecked",
      message: "该选题簇没有带禁止声明的证据包，未检查。",
    } satisfies CheckResult;
  }
  const haystack = [draft.title, draft.metaDescription, draft.body, draft.cta]
    .join("\n")
    .toLowerCase();
  const hits = claims.filter(
    (claim) => claim.trim() !== "" && haystack.includes(claim.toLowerCase()),
  );
  return hits.length === 0
    ? ({
        id: "prohibited_claims",
        level: "pass",
        message: "没有出现禁止声明的原文。",
      } satisfies CheckResult)
    : ({
        id: "prohibited_claims",
        level: "blocking",
        message: `出现了禁止声明：${hits.join("；")}。`,
      } satisfies CheckResult);
}

// Existence-only: the page must visibly contain what the markup type claims.
function structuredDataCheck(draft: ContentDraft): CheckResult {
  const type = draft.structuredDataType;
  if (!type) {
    return {
      id: "structured_data",
      level: "pass",
      message: "没有声明结构化数据。",
    };
  }
  const text = stripCode(draft.body);
  if (type === "FAQPage") {
    const questions = text.match(/^(#{2,6}\s+.*\?|\*\*[^*\n]*\?\*\*)\s*$/gm);
    return (questions?.length ?? 0) >= 2
      ? {
          id: "structured_data",
          level: "pass",
          message: "FAQPage：正文里有可见的问题。",
        }
      : {
          id: "structured_data",
          level: "blocking",
          message: "声明了 FAQPage，但正文里的问题少于 2 个。",
        };
  }
  if (type === "HowTo") {
    return /^\s*\d+[.)]\s+\S/m.test(text)
      ? {
          id: "structured_data",
          level: "pass",
          message: "HowTo：正文里有可见的编号步骤。",
        }
      : {
          id: "structured_data",
          level: "blocking",
          message: "声明了 HowTo，但正文里没有编号步骤。",
        };
  }
  return {
    id: "structured_data",
    level: "unchecked",
    message: `暂不支持检查 ${type} 类型。`,
  };
}

export function runContentChecks(
  draft: ContentDraft,
  context: CheckContext = {},
): ChecksReport {
  const bodyCheck: CheckResult =
    draft.body.trim() === ""
      ? { id: "body", level: "blocking", message: "正文为空。" }
      : { id: "body", level: "pass", message: "正文有内容。" };
  const checks = [
    lengthCheck("title_length", "标题", draft.title, TITLE_RANGE),
    lengthCheck(
      "description_length",
      "元描述",
      draft.metaDescription,
      DESCRIPTION_RANGE,
    ),
    bodyCheck,
    h1Check(draft.body),
    headingOrderCheck(draft.body),
    internalLinkCheck(draft, context),
    imageAltCheck(draft.body),
    prohibitedClaimsCheck(draft, context),
    structuredDataCheck(draft),
  ];
  return {
    checks,
    blocking: checks.filter((check) => check.level === "blocking").length,
    warnings: checks.filter((check) => check.level === "warning").length,
  };
}

const checksReportSchema = z.object({
  blocking: z.number(),
  warnings: z.number(),
  checks: z.array(
    z.object({
      id: z.string(),
      level: z.enum(["pass", "warning", "blocking", "unchecked"]),
      message: z.string(),
    }),
  ),
});

/** Stored reports are JSON text; anything unreadable counts as blocking. */
export function parseChecksReport(json: string): ChecksReport {
  try {
    const parsed = checksReportSchema.safeParse(JSON.parse(json));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  return {
    checks: [
      { id: "report", level: "blocking", message: "检查报告无法读取。" },
    ],
    blocking: 1,
    warnings: 0,
  };
}
