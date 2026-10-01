import { useQuery } from "@tanstack/react-query";
import { pageActionLabels } from "@/client/features/page-plans/pageLabels";
import {
  getPageReviewDetail,
  listPageReviewQueue,
} from "@/serverFunctions/page-publishing";
import { ErrorAlert, Loading } from "./PublishingStates";
import { DiffViewer } from "./DiffViewer";
import { PagePreview } from "./PagePreview";
import { assetStatusLabels, formatTime } from "./publishingLabels";
import { ReviewActions } from "./ReviewActions";
import {
  ChecksPanel,
  CommentsPanel,
  HistoryPanel,
  MetaPanel,
} from "./ReviewDetailPanels";

export function ReviewQueue({
  projectId,
  onSelect,
}: {
  projectId: string;
  onSelect: (assetId: string) => void;
}) {
  const queue = useQuery({
    queryKey: ["publishing", "queue", projectId],
    queryFn: () => listPageReviewQueue({ data: { projectId } }),
  });
  if (queue.isPending) return <Loading />;
  if (queue.isError) return <ErrorAlert error={queue.error} />;
  if (queue.data.length === 0) {
    return (
      <p className="rounded-xl border border-base-300 p-6 text-sm text-base-content/60">
        没有待审批的页面。Claude 通过 submit_content_version
        提交内容稿后会出现在这里。
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>标题</th>
            <th>目标地址</th>
            <th>语言</th>
            <th>动作</th>
            <th>版本</th>
            <th>阻塞</th>
            <th>警告</th>
            <th>状态</th>
            <th>提交时间</th>
          </tr>
        </thead>
        <tbody>
          {queue.data.map((row) => (
            <tr
              key={row.assetId}
              className="hover cursor-pointer"
              onClick={() => onSelect(row.assetId)}
            >
              <td className="max-w-[18rem] font-medium">
                <button
                  type="button"
                  className="link link-hover text-left"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(row.assetId);
                  }}
                >
                  {row.title}
                </button>
              </td>
              <td className="max-w-[20rem] break-all">
                {row.targetUrl ?? "-"}
              </td>
              <td>{row.language ?? "-"}</td>
              <td>
                {row.pageAction
                  ? (pageActionLabels[row.pageAction] ?? row.pageAction)
                  : "-"}
              </td>
              <td>v{row.currentVersion}</td>
              <td>
                {row.blocking > 0 ? (
                  <span className="badge badge-error badge-sm">
                    {row.blocking}
                  </span>
                ) : (
                  0
                )}
              </td>
              <td>
                {row.warnings > 0 ? (
                  <span className="badge badge-warning badge-sm">
                    {row.warnings}
                  </span>
                ) : (
                  0
                )}
              </td>
              <td>{assetStatusLabels[row.status] ?? row.status}</td>
              <td className="whitespace-nowrap">{formatTime(row.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReviewDetailView({
  projectId,
  assetId,
  onBack,
}: {
  projectId: string;
  assetId: string;
  onBack: () => void;
}) {
  const query = useQuery({
    queryKey: ["publishing", "detail", projectId, assetId],
    queryFn: () => getPageReviewDetail({ data: { projectId, assetId } }),
  });
  const detail = query.data;
  const version = detail?.version;

  return (
    <div className="space-y-5">
      <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
        ← 返回待审列表
      </button>
      {query.isPending ? <Loading /> : null}
      {query.isError ? <ErrorAlert error={query.error} /> : null}
      {detail ? (
        <>
          <header className="space-y-1">
            <h2 className="text-xl font-semibold">{detail.asset.title}</h2>
            <div className="flex flex-wrap items-center gap-2 text-sm text-base-content/70">
              <span className="badge badge-outline badge-sm">
                {assetStatusLabels[detail.asset.status] ?? detail.asset.status}
              </span>
              <span>版本 {detail.asset.currentVersion}</span>
              {detail.asset.publishedUrl ? (
                <span className="break-all">
                  已发布：{detail.asset.publishedUrl}
                </span>
              ) : null}
            </div>
          </header>
          {!version ? (
            <p className="rounded-xl border border-base-300 p-6 text-sm text-base-content/60">
              这个工单还没有提交内容稿版本。
            </p>
          ) : (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
              <div className="min-w-0 space-y-6">
                {version.draft ? (
                  <PagePreview
                    draft={version.draft}
                    targetUrl={detail.asset.targetUrl}
                  />
                ) : (
                  <p
                    role="alert"
                    className="rounded-lg bg-error/10 p-3 text-sm"
                  >
                    当前版本的内容稿无法读取，无法预览。
                  </p>
                )}
                <DiffViewer version={version} />
              </div>
              <aside className="min-w-0 space-y-6">
                <ReviewActions projectId={projectId} detail={detail} />
                <MetaPanel detail={detail} />
                <ChecksPanel version={version} />
                <HistoryPanel detail={detail} />
                <CommentsPanel projectId={projectId} detail={detail} />
              </aside>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
