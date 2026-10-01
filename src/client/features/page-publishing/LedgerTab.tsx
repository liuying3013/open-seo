import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Modal } from "@/client/components/Modal";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getPublishScreenshot,
  listPublishAttempts,
  requestPageRollback,
} from "@/serverFunctions/page-publishing";
import {
  attemptKindLabels,
  attemptStatusBadges,
  attemptStatusLabels,
  errorStageLabels,
  formatTime,
} from "./publishingLabels";
import { AlertsSection } from "./AlertsSection";
import { ErrorAlert, Loading } from "./PublishingStates";
import type { PublishAttemptRow } from "./types";

type ScreenshotKind = "desktop" | "mobile";

function Screenshot({
  projectId,
  attemptId,
  kind,
  onOpen,
}: {
  projectId: string;
  attemptId: string;
  kind: ScreenshotKind;
  onOpen: (src: string) => void;
}) {
  const query = useQuery({
    queryKey: ["publishing", "screenshot", projectId, attemptId, kind],
    queryFn: () =>
      getPublishScreenshot({ data: { projectId, attemptId, kind } }),
    staleTime: Infinity,
    retry: false,
  });
  const label = kind === "desktop" ? "桌面" : "移动";
  if (query.isPending) {
    return <span className="loading loading-spinner loading-xs" />;
  }
  if (query.isError) {
    return <span className="text-xs text-base-content/40">{label}无图</span>;
  }
  const src = `data:${query.data.contentType};base64,${query.data.base64}`;
  return (
    <button
      type="button"
      className="block"
      title={`${label}截图，点击放大`}
      onClick={() => onOpen(src)}
    >
      <img
        src={src}
        alt={`${label}截图`}
        className="h-12 w-auto rounded border border-base-300"
      />
    </button>
  );
}

const liveCheckSchema = z.object({
  noindex: z.boolean().optional(),
  canonical: z.string().nullish(),
  notes: z.string().optional(),
});

function liveSummary(json: string | null) {
  if (!json) return "-";
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return json;
  }
  const live = liveCheckSchema.safeParse(parsed);
  if (!live.success) return json;
  const { noindex, canonical, notes } = live.data;
  return [
    noindex === undefined ? null : noindex ? "noindex" : "可索引",
    canonical ? `canonical ${canonical}` : null,
    notes,
  ]
    .filter(Boolean)
    .join(" · ");
}

function AttemptRow({
  projectId,
  attempt,
  canRollback,
  onRollback,
  onOpenImage,
}: {
  projectId: string;
  attempt: PublishAttemptRow;
  canRollback: boolean;
  onRollback: () => void;
  onOpenImage: (src: string) => void;
}) {
  return (
    <tr className="align-top">
      <td className="max-w-[16rem]">
        <div className="font-medium">{attempt.assetTitle}</div>
        <div className="text-xs break-all text-base-content/60">
          {attempt.targetUrl ?? "-"}
        </div>
      </td>
      <td>{attemptKindLabels[attempt.kind] ?? attempt.kind}</td>
      <td>
        <span
          className={`badge whitespace-nowrap badge-sm ${attemptStatusBadges[attempt.status] ?? "badge-ghost"}`}
        >
          {attemptStatusLabels[attempt.status] ?? attempt.status}
        </span>
      </td>
      <td className="font-mono text-xs">
        {attempt.mergeCommit?.slice(0, 10) ?? "-"}
      </td>
      <td className="font-mono text-xs break-all">
        {attempt.coolifyDeploymentUuid ?? "-"}
      </td>
      <td>{attempt.textMatch === null ? "-" : `${attempt.textMatch}%`}</td>
      <td className="max-w-[16rem] text-xs">
        {attempt.liveStatusCode !== null
          ? `HTTP ${attempt.liveStatusCode}`
          : ""}{" "}
        {liveSummary(attempt.liveCheckSummary)}
      </td>
      <td className="max-w-[16rem] text-xs">
        {attempt.errorStage || attempt.errorMessage ? (
          <span className="text-error">
            {attempt.errorStage
              ? `[${errorStageLabels[attempt.errorStage] ?? attempt.errorStage}] `
              : ""}
            {attempt.errorMessage}
          </span>
        ) : (
          "-"
        )}
      </td>
      <td>
        {attempt.screenshotDesktopKey || attempt.screenshotMobileKey ? (
          <div className="flex gap-2">
            {attempt.screenshotDesktopKey ? (
              <Screenshot
                projectId={projectId}
                attemptId={attempt.id}
                kind="desktop"
                onOpen={onOpenImage}
              />
            ) : null}
            {attempt.screenshotMobileKey ? (
              <Screenshot
                projectId={projectId}
                attemptId={attempt.id}
                kind="mobile"
                onOpen={onOpenImage}
              />
            ) : null}
          </div>
        ) : (
          "-"
        )}
      </td>
      <td className="text-xs whitespace-nowrap">
        <div>{formatTime(attempt.createdAt)}</div>
        {attempt.finishedAt ? (
          <div className="text-base-content/60">
            完成 {formatTime(attempt.finishedAt)}
          </div>
        ) : null}
      </td>
      <td>
        {canRollback ? (
          <button
            type="button"
            className="btn btn-outline btn-xs"
            onClick={onRollback}
          >
            回滚
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function AttemptsSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [image, setImage] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] =
    useState<PublishAttemptRow | null>(null);
  const attempts = useQuery({
    queryKey: ["publishing", "attempts", projectId],
    queryFn: () => listPublishAttempts({ data: { projectId } }),
    // Rollbacks and publishes are carried out by the publisher in the background.
    refetchInterval: 30_000,
  });
  const rollback = useMutation({
    mutationFn: (assetId: string) =>
      requestPageRollback({ data: { projectId, assetId } }),
    onSuccess: () => {
      setRollbackTarget(null);
      toast.success("已请求回滚，发布器会在下次运行时执行");
      void queryClient.invalidateQueries({ queryKey: ["publishing"] });
    },
    onError: (error) => {
      setRollbackTarget(null);
      toast.error(getStandardErrorMessage(error));
    },
  });

  // Rows are newest first, so the first row seen per work order is its latest
  // attempt. Only a work order whose latest attempt is a finished publish can
  // be rolled back; a queued or running rollback hides the button.
  const latestByAsset = new Map<string, string>();
  for (const attempt of attempts.data ?? []) {
    if (!latestByAsset.has(attempt.assetId)) {
      latestByAsset.set(attempt.assetId, attempt.id);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">发布尝试</h2>
      {attempts.isPending ? <Loading /> : null}
      {attempts.isError ? <ErrorAlert error={attempts.error} /> : null}
      {attempts.data?.length === 0 ? (
        <p className="rounded-xl border border-base-300 p-6 text-sm text-base-content/60">
          还没有发布记录。
        </p>
      ) : null}
      {attempts.data && attempts.data.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>工单</th>
                <th>类型</th>
                <th>状态</th>
                <th>Merge commit</th>
                <th>部署 uuid</th>
                <th>文本匹配</th>
                <th>验收摘要</th>
                <th>错误</th>
                <th>截图</th>
                <th>时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {attempts.data.map((attempt) => (
                <AttemptRow
                  key={attempt.id}
                  projectId={projectId}
                  attempt={attempt}
                  canRollback={
                    attempt.kind === "publish" &&
                    attempt.status === "published" &&
                    latestByAsset.get(attempt.assetId) === attempt.id
                  }
                  onRollback={() => setRollbackTarget(attempt)}
                  onOpenImage={setImage}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {rollbackTarget ? (
        <Modal
          onClose={
            rollback.isPending ? undefined : () => setRollbackTarget(null)
          }
          labelledBy="rollback-title"
        >
          <h3 id="rollback-title" className="text-lg font-semibold">
            回滚 {rollbackTarget.assetTitle}
          </h3>
          <p className="text-sm text-base-content/70">
            回滚后页面会回到草稿状态，并由发布器在下次运行时执行。
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={rollback.isPending}
              onClick={() => setRollbackTarget(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-error btn-sm"
              disabled={rollback.isPending}
              onClick={() => rollback.mutate(rollbackTarget.assetId)}
            >
              {rollback.isPending ? "提交中…" : "确认回滚"}
            </button>
          </div>
        </Modal>
      ) : null}

      {image ? (
        <Modal maxWidth="max-w-5xl" onClose={() => setImage(null)}>
          <img src={image} alt="发布截图" className="max-h-[75vh] w-auto" />
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setImage(null)}
            >
              关闭
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

export function LedgerTab({ projectId }: { projectId: string }) {
  return (
    <div className="space-y-8">
      <AlertsSection projectId={projectId} />
      <AttemptsSection projectId={projectId} />
    </div>
  );
}
