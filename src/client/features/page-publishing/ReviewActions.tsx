import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/client/components/Modal";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  approvePageVersion,
  rejectPageVersion,
  revokePageApproval,
} from "@/serverFunctions/page-publishing";
import type { ReviewDetail } from "./types";

type Mode = "approve" | "reject" | "revoke";

export function ReviewActions({
  projectId,
  detail,
}: {
  projectId: string;
  detail: ReviewDetail;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode | null>(null);
  const [publishAt, setPublishAt] = useState("");
  const [text, setText] = useState("");
  const { asset, version } = detail;
  const assetId = asset.id;

  const close = () => {
    setMode(null);
    setPublishAt("");
    setText("");
  };
  const done = (message: string) => {
    toast.success(message);
    close();
    void queryClient.invalidateQueries({ queryKey: ["publishing"] });
  };
  const failed = (error: unknown) =>
    toast.error(getStandardErrorMessage(error));

  const approve = useMutation({
    mutationFn: (versionId: string) =>
      approvePageVersion({
        data: {
          projectId,
          assetId,
          versionId,
          publishAt: publishAt ? new Date(publishAt).toISOString() : undefined,
          comment: text.trim() || undefined,
        },
      }),
    onSuccess: () => done("已批准，发布器会在到点后发布"),
    onError: failed,
  });
  const reject = useMutation({
    mutationFn: (versionId: string) =>
      rejectPageVersion({
        data: { projectId, assetId, versionId, comment: text.trim() },
      }),
    onSuccess: () => done("已退回"),
    onError: failed,
  });
  const revoke = useMutation({
    mutationFn: () => revokePageApproval({ data: { projectId, assetId } }),
    onSuccess: () => done("已撤销批准"),
    onError: failed,
  });

  if (!version) return null;
  const blocking = version.checks.blocking;
  const canApprove = asset.status === "qa_review";
  const canReject =
    asset.status === "qa_review" || asset.status === "ready_to_publish";
  const canRevoke = asset.status === "ready_to_publish";
  if (!canApprove && !canReject && !canRevoke) return null;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canApprove ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={blocking > 0}
            onClick={() => setMode("approve")}
          >
            批准
          </button>
        ) : null}
        {canReject ? (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setMode("reject")}
          >
            退回
          </button>
        ) : null}
        {canRevoke ? (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setMode("revoke")}
          >
            撤销批准
          </button>
        ) : null}
      </div>
      {canApprove && blocking > 0 ? (
        <p className="text-xs text-error">
          当前版本有 {blocking} 项阻塞检查，修复并提交新版本后才能批准。
        </p>
      ) : null}

      {mode === "approve" ? (
        <Modal
          onClose={approve.isPending ? undefined : close}
          labelledBy="approve-title"
        >
          <h3 id="approve-title" className="text-lg font-semibold">
            批准版本 {version.version}
          </h3>
          <label className="form-control gap-1 text-sm">
            发布时间（可选，留空则尽快发布）
            <input
              type="datetime-local"
              className="input input-bordered input-sm"
              value={publishAt}
              onChange={(event) => setPublishAt(event.target.value)}
            />
          </label>
          <label className="form-control gap-1 text-sm">
            备注（可选）
            <textarea
              className="textarea textarea-bordered"
              rows={3}
              maxLength={2000}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={approve.isPending}
              onClick={close}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={approve.isPending}
              onClick={() => approve.mutate(version.id)}
            >
              {approve.isPending ? "批准中…" : "确认批准"}
            </button>
          </div>
        </Modal>
      ) : null}

      {mode === "reject" ? (
        <Modal
          onClose={reject.isPending ? undefined : close}
          labelledBy="reject-title"
        >
          <h3 id="reject-title" className="text-lg font-semibold">
            退回版本 {version.version}
          </h3>
          <label className="form-control gap-1 text-sm">
            退回意见（必填）
            <textarea
              className="textarea textarea-bordered"
              rows={4}
              maxLength={2000}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={reject.isPending}
              onClick={close}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-error btn-sm"
              disabled={reject.isPending || text.trim() === ""}
              onClick={() => reject.mutate(version.id)}
            >
              {reject.isPending ? "退回中…" : "确认退回"}
            </button>
          </div>
        </Modal>
      ) : null}

      {mode === "revoke" ? (
        <Modal
          onClose={revoke.isPending ? undefined : close}
          labelledBy="revoke-title"
        >
          <h3 id="revoke-title" className="text-lg font-semibold">
            撤销批准
          </h3>
          <p className="text-sm text-base-content/70">
            撤销后页面回到待审批状态，发布器不会再发布它。
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={revoke.isPending}
              onClick={close}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-error btn-sm"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              {revoke.isPending ? "撤销中…" : "确认撤销"}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
