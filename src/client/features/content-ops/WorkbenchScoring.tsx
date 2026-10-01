import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { runWorkbenchClusterAction } from "./workbenchApi";
import type {
  WorkbenchTask as Task,
  WorkbenchTopic,
  WorkbenchOverview,
} from "./workbenchTypes";
export function PreScore({
  scope,
  busy,
  onRun,
}: {
  scope: { projectId: string; clusterId: string };
  busy: boolean;
  onRun: (task: Task) => void;
}) {
  const form = useForm({
    defaultValues: { businessFit: 50, reason: "" },
    onSubmit: ({ value }) => {
      onRun({
        label: "保存预筛判断",
        run: async () => {
          const result = await runWorkbenchClusterAction({
            data: { ...scope, action: "pre_score", ...value },
          });
          if ("proceedToSerp" in result && !result.proceedToSerp)
            toast.info("业务匹配不足 40，建议暂不投入搜索预算。");
          return result;
        },
      });
    },
  });
  return (
    <form
      className="space-y-3 rounded-lg bg-base-200 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <h3 className="font-medium">先判断是否值得研究</h3>
      <form.Field name="businessFit">
        {(f) => (
          <label className="block text-sm">
            业务匹配度（0–100）
            <input
              className="input input-bordered mt-1 w-full"
              type="number"
              min={0}
              max={100}
              required
              value={f.state.value}
              onChange={(e) => f.handleChange(Number(e.target.value))}
            />
          </label>
        )}
      </form.Field>
      <form.Field name="reason">
        {(f) => (
          <label className="block text-sm">
            判断依据
            <textarea
              required
              className="textarea textarea-bordered mt-1 w-full"
              value={f.state.value}
              onChange={(e) => f.handleChange(e.target.value)}
              placeholder="这个问题与我们能提供的产品、服务有什么关系？"
            />
          </label>
        )}
      </form.Field>
      <button className="btn btn-primary btn-sm" disabled={busy}>
        保存预筛
      </button>
    </form>
  );
}

export function ScoreForm({
  scope,
  topic,
  offers,
  busy,
  onRun,
}: {
  scope: { projectId: string; clusterId: string };
  topic: WorkbenchTopic;
  offers: WorkbenchOverview["offers"];
  busy: boolean;
  onRun: (task: Task) => void;
}) {
  const form = useForm({
    defaultValues: {
      offerId: topic.cluster.offerId ?? "",
      purchaseProximity: 50,
      conversionReadiness: 50,
      coreRelevance: 50,
    },
    onSubmit: ({ value }) =>
      onRun({
        label: "计算商业价值",
        run: () =>
          runWorkbenchClusterAction({
            data: {
              ...scope,
              action: "score",
              ...value,
              offerId: value.offerId || undefined,
            },
          }),
      }),
  });
  return (
    <form
      className="space-y-3 rounded-lg border border-base-300 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <h3 className="font-medium">商业价值评分</h3>
      <p className="text-xs text-base-content/60">
        先分析搜索结果，再根据你们的实际业务判断。系统按已有规则计算总分。
      </p>
      <form.Field name="offerId">
        {(f) => (
          <label className="block text-sm">
            关联产品
            <select
              className="select select-bordered mt-1 w-full"
              value={f.state.value}
              onChange={(e) => f.handleChange(e.target.value)}
            >
              <option value="">未关联</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </form.Field>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["purchaseProximity", "购买接近度"],
            ["conversionReadiness", "转化路径就绪"],
            ["coreRelevance", "核心业务相关"],
          ] as const
        ).map(([name, label]) => (
          <form.Field key={name} name={name}>
            {(f) => (
              <label className="text-sm">
                {label}
                <input
                  type="number"
                  min={0}
                  max={100}
                  required
                  className="input input-bordered mt-1 w-full"
                  value={f.state.value}
                  onChange={(e) => f.handleChange(Number(e.target.value))}
                />
              </label>
            )}
          </form.Field>
        ))}
      </div>
      <button
        className="btn btn-primary btn-sm"
        disabled={
          busy ||
          !topic.cluster.intentVector ||
          topic.cluster.entityCategory === "AMBIGUOUS"
        }
      >
        计算价值分
      </button>
    </form>
  );
}
