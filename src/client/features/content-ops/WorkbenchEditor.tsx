import { WorkbenchDraftEditor } from "./WorkbenchDraftEditor";
import { useCallback, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Markdown } from "@/client/components/Markdown";
import { Modal } from "@/client/components/Modal";
import { runWorkbenchAssetAction } from "./workbenchApi";
import { draftSchema } from "@/server/features/content-factory/prompts/generateDraft";
import { assetLabels, type WorkbenchAsset } from "./workbenchTypes";

const storedQaSchema = z.object({
  verdict: z.string(),
  explanation: z.string(),
  findings: z.array(
    z.object({
      dimension: z.string(),
      severity: z.string(),
      detail: z.string(),
    }),
  ),
});
function readDraft(raw: string | null) {
  try {
    return raw ? draftSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function readQa(raw: string | null) {
  try {
    return raw ? storedQaSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
const actionLabels = {
  brief: "生成写作提纲",
  draft: "生成文章",
  qa: "运行 QA",
} as const;

type Props = {
  asset: WorkbenchAsset;
  packApproved: boolean;
  disabled: boolean;
  onRefresh: () => Promise<void>;
  onBusy: (value: boolean) => void;
  onDirty: (value: boolean) => void;
};
export function WorkbenchEditor({
  asset,
  packApproved,
  disabled,
  onRefresh,
  onBusy,
  onDirty,
}: Props) {
  const [confirm, setConfirm] = useState<keyof typeof actionLabels | null>(
    null,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const task = useMutation({
    mutationFn: (action: keyof typeof actionLabels) =>
      runWorkbenchAssetAction({
        data: {
          projectId: asset.projectId,
          assetId: asset.id,
          action,
          confirmed: true,
        },
      }),
    retry: false,
    onSuccess: async () => {
      setConfirm(null);
      await onRefresh();
      toast.success("内容已保存");
    },
    onError: (e) => {
      setConfirm(null);
      toast.error(e.message);
    },
  });
  const busy = task.isPending || saving;
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  const updateDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirty(value);
    },
    [onDirty],
  );
  const draft = readDraft(asset.draft);
  const qa = readQa(asset.qaReport);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge badge-outline">
          {dirty ? "有未保存修改" : (assetLabels[asset.status] ?? asset.status)}
        </span>
        <span className="text-xs text-base-content/50">{asset.updatedAt}</span>
      </div>
      {!packApproved && (
        <p className="rounded-lg bg-warning/10 p-3 text-sm">
          请先在“证据与取材”批准证据包，再生成内容。
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {asset.status === "planned" && (
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || disabled || !packApproved}
            onClick={() => setConfirm("brief")}
          >
            生成写作提纲
          </button>
        )}
        {["brief_ready", "qa_review"].includes(asset.status) && (
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || disabled || dirty || !packApproved}
            onClick={() => setConfirm("draft")}
          >
            {draft ? "重新生成文章" : "生成文章"}
          </button>
        )}
        {draft &&
          ["drafted", "qa_review", "ready_to_publish"].includes(
            asset.status,
          ) && (
            <button
              className="btn btn-sm btn-outline"
              disabled={busy || disabled || dirty || !packApproved}
              onClick={() => setConfirm("qa")}
            >
              运行 QA
            </button>
          )}
      </div>
      {task.isPending && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-sm"
        >
          <Loader2 className="size-4 animate-spin" />
          {task.variables && actionLabels[task.variables]}中，请等待结果保存…
        </p>
      )}
      {task.isError && (
        <p role="alert" className="text-sm text-error">
          {task.error.message}。若超时，请先刷新查看已保存结果，避免重复生成。
        </p>
      )}
      {asset.brief && (
        <details
          open={!draft}
          className="rounded-lg border border-base-300 p-4"
        >
          <summary className="cursor-pointer text-sm font-medium">
            写作提纲{asset.angle ? ` · ${asset.angle}` : ""}
          </summary>
          <Markdown className="mt-3 text-sm">{asset.brief}</Markdown>
        </details>
      )}
      {asset.draft && !draft && (
        <p role="alert" className="text-sm text-error">
          保存的文章格式无法解析，未覆盖原始数据。请检查记录。
        </p>
      )}
      {draft && (
        <WorkbenchDraftEditor
          key={`${asset.id}:${asset.draft}`}
          asset={asset}
          draft={draft}
          disabled={
            busy ||
            disabled ||
            !["drafted", "qa_review", "ready_to_publish"].includes(asset.status)
          }
          onRefresh={onRefresh}
          onSaving={setSaving}
          onDirty={updateDirty}
        />
      )}
      {qa && !dirty && (
        <section
          className={`rounded-lg border p-4 space-y-3 ${qa.verdict === "pass" ? "border-success/40 bg-success/5" : "border-warning/40 bg-warning/5"}`}
        >
          <h3 className="font-medium">
            QA：{qa.verdict === "pass" ? "通过" : "需要处理"}
          </h3>
          <p className="text-sm">{qa.explanation}</p>
          <ul className="space-y-2">
            {qa.findings.map((f, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">
                  {f.severity === "blocker"
                    ? "阻断"
                    : f.severity === "fix"
                      ? "需修改"
                      : "提示"}
                </span>{" "}
                · {f.dimension}
                <p className="mt-1 text-base-content/70">{f.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {draft && !qa && (
        <p className="text-xs text-base-content/60">
          当前版本尚无有效 QA 结果。编辑保存后需要重新审核。
        </p>
      )}
      {confirm && (
        <Modal
          onClose={busy ? undefined : () => setConfirm(null)}
          labelledBy="asset-action-confirm"
        >
          <h3 className="text-lg font-semibold" id="asset-action-confirm">
            {actionLabels[confirm]}
          </h3>
          <p className="text-sm">
            {confirm === "qa"
              ? "QA 会检查事实、业务边界与表达，最多自动改写 2 轮，共最多 5 次 AI 调用。通过后标记为可交付，不会自动发布。"
              : `本步骤消耗 1 次 AI 调用及模型费用。${confirm === "draft" && draft ? "重新生成会替换当前草稿，请先导出需要保留的版本。" : "内容将使用已经批准的证据。"}`}
          </p>
          <div className="flex justify-end gap-2">
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              取消
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => task.mutate(confirm)}
            >
              {busy ? "执行中…" : "确认执行"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
