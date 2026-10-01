import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { commentOnPage } from "@/serverFunctions/page-publishing";
import {
  checkIdLabels,
  checkLevelBadges,
  checkLevelLabels,
  checkLevelOrder,
  commentAuthor,
  formatTime,
  shortUserId,
} from "./publishingLabels";
import type { ReviewDetail } from "./types";

type Version = NonNullable<ReviewDetail["version"]>;

export function ChecksPanel({ version }: { version: Version }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">检查结果</h2>
      {checkLevelOrder.map((level) => {
        const checks = version.checks.checks.filter(
          (check) => check.level === level,
        );
        if (checks.length === 0) return null;
        return (
          <div key={level} className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <span className={`badge badge-sm ${checkLevelBadges[level]}`}>
                {checkLevelLabels[level]}
              </span>
              <span className="text-base-content/60">{checks.length} 项</span>
            </div>
            <ul className="space-y-1 pl-1 text-sm">
              {checks.map((check) => (
                <li key={check.id}>
                  <span className="font-medium">
                    {checkIdLabels[check.id] ?? check.id}
                  </span>
                  ：{check.message}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {version.qaReport ? <QaReport report={version.qaReport} /> : null}
    </section>
  );
}

// QA reports are stored as JSON text; show it pretty-printed when it parses.
function QaReport({ report }: { report: string }) {
  let text = report;
  try {
    text = JSON.stringify(JSON.parse(report), null, 2);
  } catch {
    // Not JSON: show as written.
  }
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold">QA 报告</h3>
      <pre className="max-h-80 overflow-auto rounded-lg bg-base-200 p-3 text-xs whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}

export function MetaPanel({ detail }: { detail: ReviewDetail }) {
  const { asset, version } = detail;
  const draft = version?.draft;
  const rows: [string, string | null | undefined][] = [
    ["标题（H1）", draft?.title],
    ["搜索结果标题", draft && (draft.seoTitle || "与标题相同")],
    ["描述", draft?.metaDescription],
    ["Slug", draft?.slug],
    ["目标地址", asset.targetUrl],
    ["语言", draft?.language ?? asset.language],
    ["动作", asset.pageAction],
    ["结构化数据", draft?.structuredDataType],
  ];
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">元信息</h2>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-base-content/60">{label}</dt>
            <dd className="break-words">{value || "-"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function HistoryPanel({ detail }: { detail: ReviewDetail }) {
  const versionNumbers = new Map(
    detail.versions.map((item) => [item.id, item.version]),
  );
  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">版本历史</h2>
        <ul className="space-y-1 text-sm">
          {detail.versions.map((item) => (
            <li key={item.id}>
              版本 {item.version}
              {item.version === detail.asset.currentVersion
                ? "（当前）"
                : ""} · {item.createdBy === "agent" ? "Claude" : "用户"} ·{" "}
              {formatTime(item.createdAt)}
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">批准历史</h2>
        {detail.approvals.length === 0 ? (
          <p className="text-sm text-base-content/60">还没有审批记录。</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {detail.approvals.map((approval) => (
              <li key={approval.id} className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`badge badge-sm ${approval.decision === "approved" ? "badge-success" : "badge-error"}`}
                  >
                    {approval.decision === "approved" ? "批准" : "退回"}
                  </span>
                  {approval.isActive ? (
                    <span className="badge badge-outline badge-sm">有效</span>
                  ) : approval.revokedAt ? (
                    <span className="badge badge-ghost badge-sm">已撤销</span>
                  ) : approval.decision === "approved" ? (
                    <span className="badge badge-ghost badge-sm">已失效</span>
                  ) : null}
                  <span className="text-base-content/60">
                    版本 {versionNumbers.get(approval.versionId) ?? "?"} · 用户{" "}
                    {shortUserId(approval.decidedByUserId)} ·{" "}
                    {formatTime(approval.decidedAt)}
                  </span>
                </div>
                {approval.publishAt ? (
                  <div className="text-base-content/60">
                    计划发布 {formatTime(approval.publishAt)}
                  </div>
                ) : null}
                {approval.comment ? <div>{approval.comment}</div> : null}
                {approval.revokedAt ? (
                  <div className="text-base-content/60">
                    {formatTime(approval.revokedAt)} 撤销
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function CommentsPanel({
  projectId,
  detail,
}: {
  projectId: string;
  detail: ReviewDetail;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const comment = useMutation({
    mutationFn: () =>
      commentOnPage({
        data: { projectId, assetId: detail.asset.id, body: body.trim() },
      }),
    onSuccess: () => {
      setBody("");
      void queryClient.invalidateQueries({ queryKey: ["publishing"] });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">评论</h2>
      {detail.comments.length === 0 ? (
        <p className="text-sm text-base-content/60">还没有评论。</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {detail.comments.map((item) => (
            <li key={item.id} className="rounded-lg bg-base-200 p-2">
              <div className="text-xs text-base-content/60">
                {commentAuthor(item.userId)} · {formatTime(item.createdAt)}
              </div>
              <div className="whitespace-pre-wrap">{item.body}</div>
            </li>
          ))}
        </ul>
      )}
      <textarea
        className="textarea textarea-bordered w-full"
        rows={3}
        maxLength={4000}
        placeholder="写下评论…"
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <button
        type="button"
        className="btn btn-outline btn-sm"
        disabled={comment.isPending || body.trim() === ""}
        onClick={() => comment.mutate()}
      >
        {comment.isPending ? "发送中…" : "发表评论"}
      </button>
    </section>
  );
}
