import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  listSiteChangeAlerts,
  resolveSiteChangeAlert,
} from "@/serverFunctions/page-publishing";
import { formatTime } from "./publishingLabels";
import { ErrorAlert, Loading } from "./PublishingStates";

export function AlertsSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const alerts = useQuery({
    queryKey: ["publishing", "alerts", projectId],
    queryFn: () => listSiteChangeAlerts({ data: { projectId } }),
  });
  const resolve = useMutation({
    mutationFn: (alertId: string) =>
      resolveSiteChangeAlert({ data: { projectId, alertId } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["publishing"] }),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">未审批变更告警</h2>
      <p className="text-sm text-base-content/60">
        生产分支上没有审批记录的提交，由发布器每次运行时检查并上报。
      </p>
      {alerts.isPending ? <Loading /> : null}
      {alerts.isError ? <ErrorAlert error={alerts.error} /> : null}
      {alerts.data?.length === 0 ? (
        <p className="rounded-xl border border-base-300 p-6 text-sm text-base-content/60">
          没有未处理的告警。
        </p>
      ) : null}
      {alerts.data && alerts.data.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Commit</th>
                <th>作者</th>
                <th>信息</th>
                <th>发现时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {alerts.data.map((alert) => (
                <tr key={alert.id}>
                  <td className="font-mono text-xs">
                    {alert.commitSha.slice(0, 10)}
                  </td>
                  <td>{alert.author ?? "-"}</td>
                  <td className="max-w-[28rem] break-words">
                    {alert.message ?? "-"}
                  </td>
                  <td className="whitespace-nowrap">
                    {formatTime(alert.detectedAt)}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn btn-outline btn-xs"
                      disabled={resolve.isPending}
                      onClick={() => resolve.mutate(alert.id)}
                    >
                      标记已处理
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
