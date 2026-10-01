import { WorkbenchResearch } from "./WorkbenchResearch";
import { WorkbenchEvidence } from "./WorkbenchEvidence";
import { useCallback, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Modal } from "@/client/components/Modal";
import {
  runWorkbenchClusterAction,
  getWorkbenchSerpQuote,
} from "./workbenchApi";
import {
  clusterLabels,
  type WorkbenchTopic,
  type WorkbenchOverview,
} from "./workbenchTypes";
import { WorkbenchEditor } from "./WorkbenchEditor";
import { pageActionLabels } from "@/client/features/page-plans/pageLabels";

type Task = { label: string; run: () => Promise<unknown> };
const tabs = ["研究与决策", "证据与取材", "写作与导出", "操作记录"] as const;
export function WorkbenchTopicPanel({
  topic,
  offers,
  onRefresh,
  onBusy,
  onDirty,
}: {
  topic: WorkbenchTopic;
  offers: WorkbenchOverview["offers"];
  onRefresh: () => Promise<void>;
  onBusy: (value: boolean) => void;
  onDirty: (value: boolean) => void;
}) {
  const scope = {
    projectId: topic.cluster.projectId,
    clusterId: topic.cluster.id,
  };
  const [tab, setTab] = useState<(typeof tabs)[number]>(
    topic.assets.some((a) => a.draft || a.brief)
      ? "写作与导出"
      : ["decided", "brief_ready"].includes(topic.cluster.status)
        ? "证据与取材"
        : "研究与决策",
  );
  const [confirmation, setConfirmation] = useState<
    (Task & { description: string }) | null
  >(null);
  const [assetBusy, setAssetBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(topic.assets[0]?.id ?? "");
  const task = useMutation({
    mutationFn: (input: Task) => input.run(),
    retry: false,
    onSuccess: async () => {
      setConfirmation(null);
      toast.success("已保存，可以继续下一步");
      await onRefresh();
    },
    onError: (e) => {
      setConfirmation(null);
      toast.error(e.message);
    },
  });
  const quote = useMutation({
    mutationFn: () => getWorkbenchSerpQuote({ data: scope }),
    retry: false,
    onSuccess: (q) =>
      setConfirmation({
        label: "抓取搜索结果",
        description: `将查询 ${q.representatives.map((k) => k.keyword).join("、")} 的桌面端前 ${q.depth} 条结果，共 ${q.requestCount} 次请求。按系统费率估算约 $${q.costUsd.toFixed(5)}（含 hosted 服务加价，实际按供应商返回计费）。会追加新的快照，现有缓存保留。`,
        run: () =>
          runWorkbenchClusterAction({
            data: {
              ...scope,
              action: "fetch_serps",
              confirmed: true,
              approvedRequestKey: q.requestKey,
            },
          }),
      }),
    onError: (e) => toast.error(e.message),
  });
  const busy = task.isPending || quote.isPending || assetBusy;
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  const changeDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirty(value);
    },
    [onDirty],
  );
  const action = (
    label: string,
    actionName: "analyze" | "decide" | "read_pages" | "build_pack",
    ai = false,
  ) => {
    const next = {
      label,
      run: () =>
        runWorkbenchClusterAction({ data: { ...scope, action: actionName } }),
    };
    if (ai)
      setConfirmation({
        ...next,
        description:
          "本步骤使用项目已保存的数据，可能消耗 1 次 AI 调用及模型费用；不会自动抓取新的搜索结果。",
      });
    else task.mutate(next);
  };
  const asset =
    topic.assets.find((a) => a.id === selectedAsset) ?? topic.assets[0];
  return (
    <section className="min-w-0 rounded-xl border border-base-300 bg-base-100">
      <div className="border-b border-base-300 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{topic.cluster.name}</h2>
          <span className="badge badge-outline text-xs">
            {clusterLabels[topic.cluster.status]}
          </span>
        </div>
        <p className="mt-2 text-xs text-base-content/60">
          {topic.keywords.map((k) => k.keyword).join(" · ")}
        </p>
        {(topic.cluster.plannedAction ||
          topic.targetPage ||
          topic.cluster.targetUrl) && (
          <p className="mt-2 text-xs">
            <span className="text-base-content/60">目标页面：</span>
            {topic.targetPage?.url ?? topic.cluster.targetUrl ?? "未指定"}
            {topic.cluster.plannedAction && (
              <>
                <span className="text-base-content/60"> · 计划动作：</span>
                {pageActionLabels[topic.cluster.plannedAction]}
              </>
            )}
            {topic.cluster.actionReason && (
              <span className="text-base-content/60">
                {" "}
                （{topic.cluster.actionReason}）
              </span>
            )}
          </p>
        )}
      </div>
      <div
        role="tablist"
        aria-label="内容生产阶段"
        className="flex overflow-x-auto border-b border-base-300 px-3"
      >
        {tabs.map((t) => (
          <button
            role="tab"
            aria-selected={tab === t}
            key={t}
            disabled={busy}
            onClick={() => {
              if (t === tab) return;
              if (dirty && !window.confirm("有未保存的文章修改，确定切换吗？"))
                return;
              changeDirty(false);
              setTab(t);
            }}
            className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm ${tab === t ? "border-primary text-primary font-medium" : "border-transparent text-base-content/60"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {(task.isPending || quote.isPending) && (
        <div
          role="status"
          className="flex items-center gap-2 bg-primary/5 px-5 py-3 text-sm"
        >
          <Loader2 className="size-4 animate-spin" />
          {quote.isPending ? "正在计算请求范围与费用" : task.variables?.label}…
          完成后会保存结果，请勿重复提交。
        </div>
      )}
      {task.isError && (
        <div
          role="alert"
          className="m-5 rounded-lg bg-error/10 p-3 text-sm text-error"
        >
          {task.error.message}
          <p className="mt-1">
            若请求超时，请先刷新查看已保存结果，再决定是否重试。
          </p>
        </div>
      )}
      <div className="p-5 space-y-5" role="tabpanel">
        {tab === "研究与决策" && (
          <WorkbenchResearch
            topic={topic}
            offers={offers}
            busy={busy}
            onRun={(t) => task.mutate(t)}
            action={action}
            onQuote={() => quote.mutate()}
            onContinue={() => setTab("证据与取材")}
          />
        )}
        {tab === "证据与取材" && (
          <WorkbenchEvidence
            topic={topic}
            busy={busy}
            onRun={(t) => task.mutate(t)}
            action={action}
            onContinue={() => setTab("写作与导出")}
          />
        )}
        {tab === "写作与导出" && (
          <>
            {!asset ? (
              <p className="text-sm text-base-content/60">
                先在“研究与决策”批准方案，系统才会创建各平台的内容任务。
              </p>
            ) : (
              <>
                <label className="flex flex-wrap items-center gap-3 text-sm">
                  内容任务
                  <select
                    aria-label="选择内容任务"
                    className="select select-bordered max-w-full"
                    disabled={busy}
                    value={asset.id}
                    onChange={(e) => {
                      if (
                        dirty &&
                        !window.confirm("文章有未保存修改，确定切换吗？")
                      )
                        return;
                      changeDirty(false);
                      setSelectedAsset(e.target.value);
                    }}
                  >
                    {topic.assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.platform === "money_site" ? "官网" : a.platform} ·{" "}
                        {a.title ?? "待拟标题"}
                      </option>
                    ))}
                  </select>
                </label>
                <WorkbenchEditor
                  key={asset.id}
                  asset={asset}
                  packApproved={topic.pack?.status === "approved"}
                  disabled={task.isPending}
                  onRefresh={onRefresh}
                  onBusy={setAssetBusy}
                  onDirty={changeDirty}
                />
              </>
            )}
          </>
        )}
        {tab === "操作记录" && (
          <ol className="space-y-4">
            {topic.log.map((log) => (
              <li key={log.id} className="border-l-2 border-base-300 pl-3">
                <p className="text-xs text-base-content/50">
                  {log.createdAt} ·{" "}
                  {log.createdBy === "user" ? "人工操作" : "系统执行"}
                </p>
                <p className="mt-1 text-sm">{log.reasonSummary}</p>
              </li>
            ))}
            {!topic.log.length && (
              <p className="text-sm text-base-content/60">还没有操作记录。</p>
            )}
          </ol>
        )}
      </div>
      {confirmation && (
        <Modal
          onClose={busy ? undefined : () => setConfirmation(null)}
          labelledBy="workbench-confirm"
        >
          <h3 id="workbench-confirm" className="text-lg font-semibold">
            确认{confirmation.label}
          </h3>
          <p className="text-sm leading-6">{confirmation.description}</p>
          <div className="flex justify-end gap-2">
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              取消
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => task.mutate(confirmation)}
            >
              {busy ? "执行中…" : "确认执行"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
