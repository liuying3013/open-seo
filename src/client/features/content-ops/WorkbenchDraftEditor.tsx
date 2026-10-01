import { useState, useEffect } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { z } from "zod";
import type { draftSchema } from "@/server/features/content-factory/prompts/generateDraft";
import { Download, Save } from "lucide-react";
import { downloadFile } from "@/client/lib/download";
import { Markdown } from "@/client/components/Markdown";
import { saveWorkbenchDraft } from "./workbenchApi";
import type { WorkbenchAsset } from "./workbenchTypes";
export function WorkbenchDraftEditor({
  asset,
  draft,
  disabled,
  onRefresh,
  onSaving,
  onDirty,
}: {
  asset: WorkbenchAsset;
  draft: z.infer<typeof draftSchema>;
  disabled: boolean;
  onRefresh: () => Promise<void>;
  onSaving: (v: boolean) => void;
  onDirty: (v: boolean) => void;
}) {
  const [preview, setPreview] = useState(false);
  const mutation = useMutation({
    mutationFn: saveWorkbenchDraft,
    retry: false,
    onError: (e) => toast.error(e.message),
  });
  const form = useForm({
    defaultValues: draft,
    onSubmit: async ({ value }) => {
      onSaving(true);
      try {
        await mutation.mutateAsync({
          data: {
            projectId: asset.projectId,
            assetId: asset.id,
            expectedDraft: asset.draft!,
            draft: value,
          },
        });
        onDirty(false);
        await onRefresh();
        toast.success("文章已保存，旧 QA 状态已清除");
      } finally {
        onSaving(false);
      }
    },
  });
  const values = useStore(form.store, (s) => s.values);
  const dirty = useStore(form.store, (s) => s.isDirty);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  function exportMarkdown() {
    const notice =
      asset.status === "ready_to_publish" && !dirty
        ? "QA 已通过"
        : "草稿 · 尚未通过当前版本 QA";
    const text = `# ${values.title}\n\n> ${notice}\n\n${values.body}\n`;
    downloadFile(
      text,
      `${values.slug.replace(/[^\p{L}\p{N}_-]/gu, "-") || "article"}.md`,
      "text/markdown",
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit().catch(() => {});
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">文章编辑</h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setPreview(!preview)}
          >
            {preview ? "返回编辑" : "预览正文"}
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={exportMarkdown}
          >
            <Download className="size-4" />
            导出 Markdown
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={disabled || !dirty}
          >
            <Save className="size-4" />
            {mutation.isPending ? "保存中…" : "保存修改"}
          </button>
        </div>
      </div>
      {dirty && (
        <p className="text-xs text-warning">
          有未保存修改。请先保存，再运行 QA；导出会包含当前编辑内容。
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="text-error text-sm">
          {mutation.error.message} 你的修改仍保留在编辑器中，可先导出。
        </p>
      )}
      <fieldset disabled={disabled} className="space-y-3">
        {(
          [
            ["title", "文章标题"],
            ["slug", "URL 路径"],
            ["metaDescription", "搜索摘要"],
            ["cta", "行动引导"],
          ] as const
        ).map(([name, label]) => (
          <form.Field key={name} name={name}>
            {(f) => (
              <label className="block text-sm space-y-1">
                <span>{label}</span>
                <input
                  required={name === "title" || name === "slug"}
                  className="input input-bordered w-full"
                  value={f.state.value}
                  onChange={(e) => {
                    f.handleChange(e.target.value);
                    onDirty(true);
                  }}
                />
              </label>
            )}
          </form.Field>
        ))}
        {preview ? (
          <div className="min-h-80 rounded-lg border border-base-300 p-5">
            <Markdown>{values.body}</Markdown>
          </div>
        ) : (
          <form.Field name="body">
            {(f) => (
              <label className="block text-sm space-y-1">
                <span>文章正文（Markdown）</span>
                <textarea
                  aria-label="文章正文（Markdown）"
                  required
                  className="textarea textarea-bordered min-h-[420px] w-full font-mono text-sm leading-6"
                  value={f.state.value}
                  onChange={(e) => {
                    f.handleChange(e.target.value);
                    onDirty(true);
                  }}
                />
              </label>
            )}
          </form.Field>
        )}
      </fieldset>
      <details className="text-sm">
        <summary className="cursor-pointer text-base-content/60">
          文章依据与素材建议
        </summary>
        <div className="mt-3 space-y-3">
          <p>{draft.addedValue}</p>
          <h4 className="font-medium">引用的事实</h4>
          <ul className="list-disc pl-4">
            {draft.claimsUsed.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <h4 className="font-medium">图片制作建议</h4>
          <ul className="list-disc pl-4">
            {draft.imageBriefs.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      </details>
    </form>
  );
}
