import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/client/components/Modal";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { assetLabels } from "@/client/features/content-ops/workbenchTypes";
import { PAGE_PERIOD_PATTERN, WORK_ORDER_ACTIONS } from "@/shared/pagePlans";
import {
  approvePagePlan,
  getPagePlan,
  listPagePlans,
  setPagePlanItemsIncluded,
} from "./pagePlansApi";
import { pageActionLabels, planStatusLabels } from "./pageLabels";

const currentPeriod = () => new Date().toISOString().slice(0, 7);

export function PagePlansPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(currentPeriod);
  const [confirming, setConfirming] = useState(false);
  const validPeriod = PAGE_PERIOD_PATTERN.test(period);

  const plans = useQuery({
    queryKey: ["page-plans", projectId],
    queryFn: () => listPagePlans({ data: { projectId } }),
  });
  const plan = useQuery({
    queryKey: ["page-plan", projectId, period],
    enabled: validPeriod,
    queryFn: () => getPagePlan({ data: { projectId, period } }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["page-plan", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["page-plans", projectId] });
  };

  const include = useMutation({
    mutationFn: (input: {
      planId: string;
      itemId: string;
      included: boolean;
    }) =>
      setPagePlanItemsIncluded({
        data: {
          projectId,
          planId: input.planId,
          items: [{ itemId: input.itemId, included: input.included }],
        },
      }),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const approve = useMutation({
    mutationFn: (planId: string) =>
      approvePagePlan({ data: { projectId, planId } }),
    onSuccess: (result) => {
      setConfirming(false);
      toast.success(`已批准，生成了 ${result.assets.length} 个页面工单`);
      refresh();
    },
    onError: (error) => {
      setConfirming(false);
      toast.error(error.message);
    },
  });

  const data = plan.data;
  const isDraft = data?.plan.status === "draft";
  const included = data?.items.filter((item) => item.included) ?? [];
  const workOrders = included.filter((item) =>
    WORK_ORDER_ACTIONS.includes(item.action),
  );
  const estCost = included.reduce(
    (sum, item) => sum + (item.estCostUsd ?? 0),
    0,
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">页面计划</h1>
        <p className="mt-1 text-sm text-base-content/60">
          每月一份。草稿由 Claude 通过 create_page_plan
          生成，在这里勾选并批准后，才会为纳入的条目创建页面工单。
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          月份
          <input
            type="month"
            className="input input-bordered input-sm"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </label>
        {(plans.data ?? []).map((item) => (
          <button
            key={item.id}
            className={`btn btn-xs ${item.period === period ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setPeriod(item.period)}
          >
            {item.period} · {planStatusLabels[item.status]}
          </button>
        ))}
      </div>

      {plan.isError && (
        <div role="alert" className="rounded-lg bg-error/10 p-3 text-sm">
          {getStandardErrorMessage(plan.error)}
        </div>
      )}

      {!plan.isPending && validPeriod && !data && (
        <p className="rounded-xl border border-base-300 p-6 text-sm text-base-content/60">
          {period} 还没有页面计划。让 Claude 调用 create_page_plan 生成草稿。
        </p>
      )}

      {data && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span
                  className={`badge ${isDraft ? "badge-outline" : "badge-success"}`}
                >
                  {planStatusLabels[data.plan.status]}
                </span>
                <span>
                  纳入 {included.length} / {data.items.length} 条，预计费用 $
                  {estCost.toFixed(2)}
                </span>
              </div>
              {data.plan.status === "approved" && (
                <p className="text-base-content/70">
                  批准人 {data.approvedBy ?? data.plan.approvedByUserId} ·{" "}
                  {data.plan.approvedAt}
                </p>
              )}
              {data.plan.notes && (
                <p className="text-base-content/70">{data.plan.notes}</p>
              )}
            </div>
            {isDraft && (
              <button
                className="btn btn-primary btn-sm"
                disabled={approve.isPending || include.isPending}
                onClick={() => setConfirming(true)}
              >
                批准计划
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>纳入</th>
                  <th>动作</th>
                  <th>目标网址</th>
                  <th>关联选题簇</th>
                  <th>得分</th>
                  <th>理由</th>
                  <th>置信度</th>
                  <th>预计成本</th>
                  <th>工单</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr
                    key={item.id}
                    className={item.included ? "" : "opacity-60"}
                  >
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        aria-label={`纳入 ${item.targetUrl}`}
                        checked={item.included}
                        disabled={!isDraft || include.isPending}
                        onChange={(event) =>
                          include.mutate({
                            planId: data.plan.id,
                            itemId: item.id,
                            included: event.target.checked,
                          })
                        }
                      />
                    </td>
                    <td>{pageActionLabels[item.action]}</td>
                    <td className="max-w-[22rem] break-all">
                      {item.targetUrl}
                      {item.language && (
                        <span className="badge badge-ghost badge-sm ml-2">
                          {item.language}
                        </span>
                      )}
                    </td>
                    <td>{item.clusterName ?? "-"}</td>
                    <td>{item.score ?? "-"}</td>
                    <td className="max-w-[24rem] text-xs">
                      {item.scoreReasons ?? "-"}
                    </td>
                    <td>{item.confidence ?? "-"}</td>
                    <td>
                      {item.estCostUsd === null
                        ? "-"
                        : `$${item.estCostUsd.toFixed(2)}`}
                    </td>
                    <td>
                      {item.assetId ? (
                        <Link
                          to="/p/$projectId/content-ops"
                          params={{ projectId }}
                          className="link link-primary text-xs"
                        >
                          {assetLabels[item.assetStatus ?? "planned"] ??
                            item.assetStatus}{" "}
                          · 在内容工作台查看
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {confirming && data && (
        <Modal
          onClose={approve.isPending ? undefined : () => setConfirming(false)}
          labelledBy="approve-plan-title"
        >
          <h3 id="approve-plan-title" className="text-lg font-semibold">
            批准 {data.plan.period} 页面计划
          </h3>
          <p className="text-sm leading-6">
            将为 {workOrders.length} 个纳入的条目创建页面工单（新建、更新、
            补充章节、合并）。批准后计划不能再修改。
          </p>
          <div className="flex justify-end gap-2">
            <button
              className="btn btn-ghost btn-sm"
              disabled={approve.isPending}
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={approve.isPending}
              onClick={() => approve.mutate(data.plan.id)}
            >
              {approve.isPending ? "批准中…" : "确认批准"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
