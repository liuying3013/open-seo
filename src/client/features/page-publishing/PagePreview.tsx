import { ImageIcon, Monitor, Smartphone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Markdown } from "@/client/components/Markdown";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import type { ReviewDetail } from "./types";

type Draft = NonNullable<NonNullable<ReviewDetail["version"]>["draft"]>;

const WIDTHS = { desktop: 1280, mobile: 390 } as const;
type Viewport = keyof typeof WIDTHS;

function ImagePlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="my-4 flex min-h-24 items-center gap-3 rounded-lg border border-dashed border-base-content/30 bg-base-200 p-4 text-sm text-base-content/60">
      <ImageIcon className="size-5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/**
 * Renders the content draft as a generic article: title as H1, meta
 * description, markdown body, image briefs as placeholders and the CTA. Only
 * the container width changes between viewports.
 */
export function PagePreview({
  draft,
  targetUrl,
}: {
  draft: Draft;
  targetUrl: string | null;
}) {
  const [viewport, setViewport] = useState<Viewport>("desktop");
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">内置预览</h2>
        <SegmentedToggle
          showLabels
          value={viewport}
          onChange={setViewport}
          items={[
            {
              value: "desktop",
              label: "桌面 1280",
              icon: <Monitor className="size-3.5" />,
            },
            {
              value: "mobile",
              label: "移动 390",
              icon: <Smartphone className="size-3.5" />,
            },
          ]}
        />
      </div>
      <p className="text-xs text-base-content/60">
        通用预览，不代表网站实际排版。
      </p>
      <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-200 p-3">
        <article
          className="mx-auto rounded-lg bg-base-100 p-6 text-base-content shadow-sm"
          style={{
            // Desktop fills the column up to 1280px so the text is never cut off.
            width: viewport === "desktop" ? "100%" : WIDTHS.mobile,
            maxWidth: WIDTHS[viewport],
          }}
        >
          <div className="mb-6 space-y-1 border-b border-base-300 pb-4">
            <div className="break-all text-xs text-success">
              {targetUrl ?? "（未设置目标地址）"}
            </div>
            <div className="text-lg text-info">{draft.title}</div>
            <p className="text-sm text-base-content/70">
              {draft.metaDescription}
            </p>
          </div>
          <h1 className="mb-4 text-3xl font-bold leading-tight">
            {draft.title}
          </h1>
          <Markdown
            className="text-base"
            components={{
              img: ({ alt }) => (
                <ImagePlaceholder>
                  {alt ? `图片：${alt}` : "图片（缺少 alt）"}
                </ImagePlaceholder>
              ),
            }}
          >
            {draft.body}
          </Markdown>
          {draft.imageBriefs.map((brief) => (
            <ImagePlaceholder key={brief}>配图说明：{brief}</ImagePlaceholder>
          ))}
          {draft.cta ? (
            <div className="mt-6 rounded-lg bg-primary/10 p-4 text-center font-medium">
              {draft.cta}
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
