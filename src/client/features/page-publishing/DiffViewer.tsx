import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { parseUnifiedDiff, type DiffLine } from "./diffLines";
import { fileChangeBadges, fileChangeLabels } from "./publishingLabels";
import type { ReviewDetail } from "./types";

type Version = NonNullable<ReviewDetail["version"]>;

const LINE_CLASSES: Record<DiffLine["kind"], string> = {
  add: "bg-success/15 text-success",
  del: "bg-error/15 text-error",
  hunk: "bg-info/10 text-info",
  meta: "text-base-content/50",
  context: "",
};

function FileDiff({ path, lines }: { path: string; lines: DiffLine[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-base-300">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        <span className="break-all">{path || "（无文件头）"}</span>
      </button>
      {open ? (
        <pre className="max-h-[32rem] overflow-auto border-t border-base-300 py-1 text-xs leading-5">
          {lines.map((line, index) => (
            <div
              key={index}
              className={`px-3 whitespace-pre-wrap break-all ${LINE_CLASSES[line.kind]}`}
            >
              {line.text || " "}
            </div>
          ))}
        </pre>
      ) : null}
    </div>
  );
}

export function DiffViewer({ version }: { version: Version }) {
  const parsed = useMemo(
    () => (version.diffText ? parseUnifiedDiff(version.diffText) : null),
    [version.diffText],
  );
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">代码改动</h2>
      <div className="space-y-1 text-xs text-base-content/70">
        <div>
          任务分支{" "}
          <span className="font-mono">{version.taskBranch ?? "-"}</span>
        </div>
        <div>
          基线 <span className="font-mono">{version.baseCommit ?? "-"}</span> ·
          头部 <span className="font-mono">{version.headCommit ?? "-"}</span>
        </div>
        <div>
          补丁指纹 <span className="font-mono">{version.patchId ?? "-"}</span>
        </div>
      </div>
      {version.files.length === 0 ? (
        <p className="text-sm text-base-content/60">没有文件改动记录。</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {version.files.map((file) => (
            <li key={file.path} className="flex items-center gap-2">
              <span
                className={`badge badge-sm ${fileChangeBadges[file.change] ?? "badge-ghost"}`}
              >
                {fileChangeLabels[file.change] ?? file.change}
              </span>
              <span className="font-mono text-xs break-all">{file.path}</span>
            </li>
          ))}
        </ul>
      )}
      {parsed ? (
        <div className="space-y-2">
          {parsed.truncated ? (
            <p role="alert" className="rounded-lg bg-warning/15 p-2 text-xs">
              diff 超过大小上限，已被截断，下面只显示前面的部分。
            </p>
          ) : null}
          {parsed.files.map((file, index) => (
            <FileDiff key={`${file.path}-${index}`} {...file} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-base-content/60">没有 diff。</p>
      )}
    </section>
  );
}
