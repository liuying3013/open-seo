import { useQuery } from "@tanstack/react-query";
import { listJobRuns } from "@/serverFunctions/job-runs";
import type { JobRunStatus } from "@/shared/jobRuns";

const STATUS_LABELS: Record<JobRunStatus, { label: string; badge: string }> = {
  running: { label: "运行中", badge: "badge-info" },
  succeeded: { label: "成功", badge: "badge-success" },
  failed: { label: "失败", badge: "badge-error" },
};

const TRIGGER_LABELS = { cron: "cron", http: "HTTP" } as const;

function formatDuration(startedAt: string, finishedAt: string | null) {
  if (!finishedAt) return "-";
  const seconds = Math.max(
    0,
    (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000,
  );
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

export function BackgroundJobsSettings() {
  const runsQuery = useQuery({
    queryKey: ["jobRuns"],
    queryFn: () => listJobRuns(),
  });
  const runs = runsQuery.data ?? [];

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-base-content/50">后台任务</h2>
      {runsQuery.isPending ? (
        <p className="text-sm text-base-content/60">加载中…</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-base-content/60">
          未运行过（自托管需在宿主机配置定时调用）
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>任务</th>
                <th>触发</th>
                <th>状态</th>
                <th>开始时间</th>
                <th>耗时</th>
                <th>摘要</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="font-mono">{run.job}</td>
                  <td>{TRIGGER_LABELS[run.trigger]}</td>
                  <td>
                    <span
                      className={`badge badge-sm ${STATUS_LABELS[run.status].badge}`}
                    >
                      {STATUS_LABELS[run.status].label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    {new Date(run.startedAt).toLocaleString()}
                  </td>
                  <td>{formatDuration(run.startedAt, run.finishedAt)}</td>
                  <td className="max-w-md break-words font-mono text-xs text-base-content/60">
                    {run.detail ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
