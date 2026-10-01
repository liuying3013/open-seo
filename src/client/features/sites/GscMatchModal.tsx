import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Modal } from "@/client/components/Modal";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { autoMatchGscProperties } from "@/serverFunctions/gsc";

const REASON_LABELS: Record<string, string> = {
  no_matching_property: "没有覆盖该域名的属性",
  unverified_only: "只有未验证的属性",
  no_domain: "项目没有域名",
  no_accessible_accounts: "没有可读取的 Google 账号",
};

// Shows the match plan first (a dry run), then applies it on confirmation.
export function GscMatchModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const planQuery = useQuery({
    queryKey: ["gsc-auto-match-plan"],
    queryFn: () => autoMatchGscProperties({ data: { dryRun: true } }),
    // The plan reflects live Google data; never serve a cached one.
    gcTime: 0,
  });
  const applyMutation = useMutation({
    mutationFn: () => autoMatchGscProperties({ data: { dryRun: false } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["sites"] });
      const failed = result.matched.filter((item) => !item.applied).length;
      if (failed > 0) {
        toast.error(`${failed} 个站点连接失败，其余已连接`);
      } else {
        toast.success(`已连接 ${result.matched.length} 个站点`);
      }
      onClose();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "GSC 匹配失败")),
  });

  const plan = planQuery.data;
  return (
    <Modal maxWidth="max-w-2xl" onClose={onClose} labelledBy="gsc-match-title">
      <div className="flex flex-col gap-4">
        <div>
          <h2 id="gsc-match-title" className="text-lg font-semibold">
            按域名匹配 GSC
          </h2>
          <p className="text-sm text-base-content/60">
            为尚未连接 Search Console 的站点匹配属性，优先级：域属性
            (sc-domain)、https://域名/、https://www.域名/。已有连接的站点不会改动。
          </p>
        </div>

        {planQuery.isLoading ? (
          <div className="flex justify-center py-6">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : planQuery.isError ? (
          <p className="text-sm text-error">
            {getStandardErrorMessage(planQuery.error, "无法读取匹配计划")}
          </p>
        ) : plan && !plan.hasGoogleAccount ? (
          <p className="text-sm">
            当前用户还没有关联 Google 账号。
            {plan.googleOAuthConfigured
              ? "请先在任一项目的集成设置里连接 Search Console。"
              : "服务器还没有配置 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET 和 BETTER_AUTH_SECRET。"}
          </p>
        ) : plan ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-base-content/60">
              已读取 {plan.accounts.length} 个 Google 账号；可匹配{" "}
              {plan.matched.length} 个，未匹配 {plan.unmatched.length}{" "}
              个，已连接 {plan.skipped.length} 个。
            </p>
            {plan.accounts
              .filter(
                (account) =>
                  account.requiresReconnect || account.propertiesUnavailable,
              )
              .map((account) => (
                <p key={account.accountId} className="text-warning">
                  {account.email ?? account.accountId}：
                  {account.requiresReconnect
                    ? "授权已失效，需要重新连接"
                    : "暂时无法读取属性"}
                </p>
              ))}
            {plan.matched.length > 0 ? (
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th>域名</th>
                    <th>属性</th>
                    <th>账号</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.matched.map((item) => (
                    <tr key={item.projectId}>
                      <td>{item.domain}</td>
                      <td>{item.siteUrl}</td>
                      <td>{item.accountEmail ?? item.accountId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {plan.unmatched.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-base-content/60">
                  未匹配的站点 ({plan.unmatched.length})
                </summary>
                <ul className="mt-2 list-disc pl-5">
                  {plan.unmatched.map((item) => (
                    <li key={item.projectId}>
                      {item.domain ?? item.projectId}：
                      {REASON_LABELS[item.reason] ?? item.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              applyMutation.isPending || !plan || plan.matched.length === 0
            }
            onClick={() => applyMutation.mutate()}
          >
            {applyMutation.isPending ? (
              <span className="loading loading-spinner loading-xs" />
            ) : null}
            确认连接 {plan?.matched.length ?? 0} 个站点
          </button>
        </div>
      </div>
    </Modal>
  );
}
