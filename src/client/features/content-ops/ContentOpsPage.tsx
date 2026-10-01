import { useBlocker } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, FileText, RefreshCw } from "lucide-react";
import { getContentWorkbench, getWorkbenchTopic } from "./workbenchApi";
import { clusterLabels } from "./workbenchTypes";
import { WorkbenchCreateTopic } from "./WorkbenchCreateTopic";
import { WorkbenchTopicPanel } from "./WorkbenchTopicPanel";

export function ContentOpsPage({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useBlocker({
    shouldBlockFn: () =>
      dirty && !window.confirm("文章有未保存修改，确定离开吗？"),
    enableBeforeUnload: dirty,
  });
  const overview = useQuery({
    queryKey: ["content-workbench", projectId],
    queryFn: () => getContentWorkbench({ data: { projectId } }),
  });
  const detail = useQuery({
    queryKey: ["content-workbench", projectId, selectedId],
    enabled: Boolean(selectedId),
    refetchOnWindowFocus: false,
    queryFn: () =>
      getWorkbenchTopic({ data: { projectId, clusterId: selectedId! } }),
  });
  const refresh = async () => {
    await client.invalidateQueries({
      queryKey: ["content-workbench", projectId],
    });
  };
  const select = (id: string) => {
    if (id === selectedId) return;
    if (dirty && !window.confirm("文章有未保存的修改，确定离开吗？")) return;
    setDirty(false);
    setSelectedId(id);
  };
  const clusters = overview.data?.clusters ?? [];
  const visible = clusters.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const usage = overview.data?.budget.usage;
  return (
    <div className="mx-auto max-w-[1600px] p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">内容工作台</h1>
          <p className="mt-1 text-sm text-base-content/60">
            从选题与证据，到可交付的文章。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy || dirty}
            onClick={() => void refresh()}
            aria-label="刷新工作台"
          >
            <RefreshCw className="size-4" />
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => setCreating(true)}
          >
            <Plus className="size-4" />
            新建选题
          </button>
        </div>
      </header>
      {usage && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-base-300 py-3 text-xs text-base-content/60">
          <span>{clusters.length} 个选题</span>
          <span>
            今日搜索请求 {usage.serpFetches.used} / {usage.serpFetches.limit}
          </span>
          <span>
            今日 AI 调用 {usage.llmCalls.used} / {usage.llmCalls.limit}
          </span>
          <span>操作逐步保存，可随时回来继续</span>
        </div>
      )}
      {overview.isError && (
        <div role="alert" className="alert alert-error">
          {overview.error.message}
          <button
            className="btn btn-sm"
            onClick={() => void overview.refetch()}
          >
            重试
          </button>
        </div>
      )}
      {overview.isPending ? (
        <div className="py-16 text-center" role="status">
          正在加载选题…
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-base-300 overflow-hidden">
            <label className="flex items-center gap-2 border-b border-base-300 px-3 py-2">
              <Search className="size-4 text-base-content/50" />
              <input
                aria-label="搜索选题"
                className="w-full bg-transparent py-1 text-sm outline-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索选题"
              />
            </label>
            <div className="max-h-[65vh] overflow-y-auto divide-y divide-base-200">
              {visible.map((c) => (
                <button
                  key={c.id}
                  disabled={busy}
                  onClick={() => select(c.id)}
                  aria-pressed={selectedId === c.id}
                  className={`w-full border-l-2 p-4 text-left transition-colors hover:bg-base-200 ${selectedId === c.id ? "border-primary bg-primary/5" : "border-transparent"}`}
                >
                  <div className="font-medium text-sm break-words">
                    {c.name}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-base-content/60">
                    <span>{clusterLabels[c.status]}</span>
                    {c.businessValueScore !== null && (
                      <span>价值 {c.businessValueScore}</span>
                    )}
                  </div>
                </button>
              ))}
              {!visible.length && (
                <p className="p-6 text-sm text-base-content/60">
                  {search ? "没有匹配的选题" : "还没有选题，从一组关键词开始。"}
                </p>
              )}
            </div>
          </aside>
          <main className="min-w-0">
            {!selectedId ? (
              <div className="flex min-h-96 flex-col items-center justify-center rounded-xl border border-dashed border-base-300 p-8 text-center">
                <FileText className="mb-4 size-8 text-base-content/40" />
                <h2 className="text-lg font-medium">
                  选择一个选题，开始内容生产
                </h2>
                <p className="mt-2 max-w-md text-sm text-base-content/60">
                  先确认要回答的问题，再研究搜索结果、审核证据，最后完成写作与
                  QA。
                </p>
                <button
                  className="btn btn-primary btn-sm mt-6"
                  onClick={() => setCreating(true)}
                >
                  创建第一个选题
                </button>
              </div>
            ) : detail.isPending ? (
              <p className="p-8" role="status">
                正在加载选题详情…
              </p>
            ) : detail.isError ? (
              <div className="alert alert-error" role="alert">
                {detail.error.message}
                <button
                  className="btn btn-sm"
                  onClick={() => void detail.refetch()}
                >
                  重试
                </button>
              </div>
            ) : (
              detail.data &&
              overview.data && (
                <WorkbenchTopicPanel
                  key={`${projectId}:${selectedId}`}
                  topic={detail.data}
                  offers={overview.data.offers}
                  onRefresh={refresh}
                  onBusy={setBusy}
                  onDirty={setDirty}
                />
              )
            )}
          </main>
        </div>
      )}
      {creating && overview.data && (
        <WorkbenchCreateTopic
          projectId={projectId}
          overview={overview.data}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false);
            await refresh();
            select(id);
          }}
        />
      )}
    </div>
  );
}
