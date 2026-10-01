import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Modal } from "@/client/components/Modal";
import { createWorkbenchTopic, saveWorkbenchOffer } from "./workbenchApi";
import {
  workbenchTopicSchema,
  workbenchOfferSchema,
} from "@/types/schemas/contentWorkbench";
import { jobLabels, type WorkbenchOverview } from "./workbenchTypes";

export function WorkbenchCreateTopic({
  projectId,
  overview,
  onClose,
  onCreated,
}: {
  projectId: string;
  overview: WorkbenchOverview;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [offers, setOffers] = useState(
    overview.offers.map((o) => ({ id: o.id, name: o.name })),
  );
  const [showOffer, setShowOffer] = useState(false);
  const mutation = useMutation({
    mutationFn: createWorkbenchTopic,
    retry: false,
    onSuccess: (r) => {
      if (r.clusterIds[0]) onCreated(r.clusterIds[0]);
    },
    onError: (e) => toast.error(e.message),
  });
  const form = useForm({
    defaultValues: {
      name: "",
      primaryEntity: "",
      keywordsText: "",
      offerId: "",
      entityCategory: "",
      userJob: "learn",
    },
    onSubmit: async ({ value }) => {
      const parsed = workbenchTopicSchema.safeParse({
        ...value,
        projectId,
        keywords: value.keywordsText
          .split(/\n/)
          .map((k) => k.trim())
          .filter(Boolean),
        offerId: value.offerId || undefined,
      });
      if (!parsed.success) {
        toast.error("请填写选题名称、核心实体和 1–50 个关键词。");
        return;
      }
      await mutation.mutateAsync({ data: parsed.data });
    },
  });
  return (
    <Modal
      maxWidth="max-w-2xl"
      onClose={mutation.isPending ? undefined : onClose}
      labelledBy="new-topic-title"
    >
      <h2 id="new-topic-title" className="text-xl font-semibold">
        新建内容选题
      </h2>
      <p className="text-sm text-base-content/60">
        一组能由同一篇内容回答的关键词。仅保存选题，不会发起收费查询。
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit().catch(() => {});
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["name", "选题名称"],
              ["primaryEntity", "核心产品或主题"],
            ] as const
          ).map(([name, label]) => (
            <form.Field key={name} name={name}>
              {(field) => (
                <label className="block text-sm space-y-1">
                  <span>{label}</span>
                  <input
                    required
                    className="input input-bordered w-full"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </label>
              )}
            </form.Field>
          ))}
        </div>
        <form.Field name="keywordsText">
          {(field) => (
            <label className="block text-sm space-y-1">
              <span>关键词，每行一个（前三个作为搜索代表词）</span>
              <textarea
                aria-label="关键词，每行一个（前三个作为搜索代表词）"
                required
                className="textarea textarea-bordered w-full h-28"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </label>
          )}
        </form.Field>
        {overview.candidates.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-primary">
              从 {overview.candidates.length} 个候选词中选择
            </summary>
            <div className="mt-2 flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {overview.candidates.map((k) => (
                <button
                  type="button"
                  key={k.id}
                  className="btn btn-xs btn-outline"
                  onClick={() => {
                    const old = form.getFieldValue("keywordsText");
                    const words = new Set(old.split("\n").filter(Boolean));
                    words.add(k.keyword);
                    form.setFieldValue("keywordsText", [...words].join("\n"));
                  }}
                >
                  {k.keyword}
                </button>
              ))}
            </div>
          </details>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <form.Field name="userJob">
            {(field) => (
              <label className="block text-sm space-y-1">
                <span>读者要完成什么</span>
                <select
                  className="select select-bordered w-full"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                >
                  {Object.entries(jobLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </form.Field>
          <form.Field name="offerId">
            {(field) => (
              <label className="block text-sm space-y-1">
                <span>对应的产品 / 服务</span>
                <select
                  className="select select-bordered w-full"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                >
                  <option value="">暂不关联（供给侧评分为零）</option>
                  {offers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </form.Field>
        </div>
        <form.Field name="entityCategory">
          {(field) => (
            <label className="block text-sm space-y-1">
              <span>业务品类（选填，与项目设定一致）</span>
              <input
                className="input input-bordered w-full"
                placeholder="不确定时填写 AMBIGUOUS，研究后再消歧"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </label>
          )}
        </form.Field>
        {mutation.isError && (
          <p className="text-error text-sm" role="alert">
            {mutation.error.message}
          </p>
        )}
        <div className="flex justify-between gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowOffer(!showOffer)}
          >
            添加产品 / 服务
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "正在保存…" : "创建选题"}
            </button>
          </div>
        </div>
      </form>
      {showOffer && (
        <NewOffer
          projectId={projectId}
          onSaved={(id, name) => {
            setOffers([...offers, { id, name }]);
            form.setFieldValue("offerId", id);
            setShowOffer(false);
          }}
        />
      )}
    </Modal>
  );
}

function NewOffer({
  projectId,
  onSaved,
}: {
  projectId: string;
  onSaved: (id: string, name: string) => void;
}) {
  const mutation = useMutation({
    mutationFn: saveWorkbenchOffer,
    retry: false,
    onError: (e) => toast.error(e.message),
  });
  const form = useForm({
    defaultValues: {
      name: "",
      description: "",
      marginTier: "mid",
      readiness: "partial",
      marketPriority: 3,
    },
    onSubmit: async ({ value }) => {
      const parsed = workbenchOfferSchema.safeParse({ ...value, projectId });
      if (!parsed.success) {
        toast.error("请检查产品信息。");
        return;
      }
      const result = await mutation.mutateAsync({ data: parsed.data });
      if (result.savedIds[0]) onSaved(result.savedIds[0], value.name);
    },
  });
  return (
    <form
      className="space-y-3 border-t border-base-300 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit().catch(() => {});
      }}
    >
      <h3 className="font-medium">记录你们实际能提供的产品 / 服务</h3>
      {(
        [
          ["name", "产品名称"],
          ["description", "已知规格、能力及限制"],
        ] as const
      ).map(([name, label]) => (
        <form.Field key={name} name={name}>
          {(field) => (
            <label className="block text-sm space-y-1">
              <span>{label}</span>
              <input
                required={name === "name"}
                className="input input-bordered w-full"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </label>
          )}
        </form.Field>
      ))}
      <div className="grid grid-cols-3 gap-2">
        <form.Field name="marginTier">
          {(f) => (
            <label className="text-sm">
              毛利档
              <select
                className="select select-bordered w-full"
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
              >
                <option value="high">高</option>
                <option value="mid">中</option>
                <option value="low">低</option>
              </select>
            </label>
          )}
        </form.Field>
        <form.Field name="readiness">
          {(f) => (
            <label className="text-sm">
              供给就绪
              <select
                className="select select-bordered w-full"
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
              >
                <option value="ready">已就绪</option>
                <option value="partial">部分就绪</option>
                <option value="none">未就绪</option>
              </select>
            </label>
          )}
        </form.Field>
        <form.Field name="marketPriority">
          {(f) => (
            <label className="text-sm">
              市场优先级
              <input
                type="number"
                min={1}
                max={5}
                className="input input-bordered w-full"
                value={f.state.value}
                onChange={(e) => f.handleChange(Number(e.target.value))}
              />
            </label>
          )}
        </form.Field>
      </div>
      <button className="btn btn-sm btn-outline" disabled={mutation.isPending}>
        保存产品
      </button>
    </form>
  );
}
