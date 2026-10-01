import type {
  WorkbenchTopic,
  WorkbenchOverview,
  WorkbenchTask,
  WorkbenchAction,
} from "./workbenchTypes";
import { Markdown } from "@/client/components/Markdown";
import { parseStored } from "./workbenchParsing";
import { z } from "zod";
import { reviewContentOpsDecision } from "@/serverFunctions/content-ops";
import { PreScore, ScoreForm } from "./WorkbenchScoring";
const platformPlanSchema = z.array(
  z.object({ platform: z.string(), verdict: z.string(), score: z.number() }),
);
export function WorkbenchResearch({
  topic,
  offers,
  busy,
  onRun,
  action,
  onQuote,
  onContinue,
}: {
  topic: WorkbenchTopic;
  offers: WorkbenchOverview["offers"];
  busy: boolean;
  onRun: (task: WorkbenchTask) => void;
  action: WorkbenchAction;
  onQuote: () => void;
  onContinue: () => void;
}) {
  const scope = {
    projectId: topic.cluster.projectId,
    clusterId: topic.cluster.id,
  };
  return (
    <>
      {topic.cluster.status === "new" && (
        <PreScore scope={scope} busy={busy} onRun={(t) => onRun(t)} />
      )}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">搜索结果研究</h3>
          <div className="flex flex-wrap gap-2">
            {["pre_scored", "serp_ready", "scored"].includes(
              topic.cluster.status,
            ) && (
              <button
                className="btn btn-sm btn-outline"
                disabled={busy}
                onClick={() => onQuote()}
              >
                {topic.snapshots.length
                  ? "刷新搜索结果（先估费）"
                  : "抓取搜索结果（先估费）"}
              </button>
            )}
            {["serp_ready", "scored"].includes(topic.cluster.status) && (
              <button
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => action("分析已有搜索结果", "analyze", true)}
              >
                分析已有结果
              </button>
            )}
          </div>
        </div>
        {!topic.snapshots.length && (
          <p className="text-sm text-base-content/60">
            还没有搜索快照。先完成预筛，再确认是否值得付费研究。
          </p>
        )}
        {topic.snapshots.map((group) => (
          <details
            key={group.snapshot.id}
            className="rounded-lg border border-base-300 p-3"
          >
            <summary className="cursor-pointer text-sm font-medium">
              {group.snapshot.keyword}{" "}
              <span className="font-normal text-base-content/50">
                · {group.snapshot.fetchedAt.slice(0, 10)} ·{" "}
                {group.snapshot.device} · {group.results.length} 条
              </span>
            </summary>
            <ol className="mt-3 space-y-2">
              {group.results.slice(0, 20).map((r) => (
                <li key={r.id} className="text-sm">
                  <span className="mr-2 text-base-content/40">{r.rank}.</span>
                  <Markdown>{`[${(r.title || r.url).replace(/[[\]]/g, "")}](${r.url})`}</Markdown>
                  <p className="text-xs text-base-content/50">
                    {r.contentType ?? r.resultType}
                    {r.platform ? ` · ${r.platform}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        ))}
      </section>
      {["serp_ready", "scored"].includes(topic.cluster.status) && (
        <ScoreForm
          scope={scope}
          topic={topic}
          offers={offers}
          busy={busy}
          onRun={(t) => onRun(t)}
        />
      )}
      {topic.cluster.businessValueScore !== null && (
        <div className="rounded-lg bg-base-200 p-3 text-sm">
          商业价值：
          <strong>{topic.cluster.businessValueScore} / 100</strong>
          <span className="ml-3 text-base-content/60">
            业务品类：{topic.cluster.entityCategory ?? "未指定"}
          </span>
        </div>
      )}
      {topic.cluster.status === "scored" && (
        <button
          className="btn btn-primary btn-sm"
          disabled={
            busy ||
            !topic.cluster.intentVector ||
            topic.cluster.businessValueScore === null
          }
          onClick={() => action("生成部署建议", "decide")}
        >
          生成部署建议
        </button>
      )}
      {topic.decisions.map((d) => (
        <section
          key={d.id}
          className="rounded-lg border border-base-300 p-4 space-y-3"
        >
          <div className="flex justify-between gap-2">
            <h3 className="font-medium">
              官网页面：{d.moneySitePageType ?? "未选择"}
            </h3>
            <span className="text-xs text-base-content/60">
              {d.status === "proposed"
                ? "待审核"
                : d.status === "approved"
                  ? "已批准"
                  : d.status}
            </span>
          </div>
          <p className="text-sm text-base-content/70">{d.reasonSummary}</p>
          <div className="flex flex-wrap gap-2">
            {parseStored(platformPlanSchema, d.platformPlan)?.map((p) => (
              <span key={p.platform} className="badge badge-outline text-xs">
                {p.platform} · {p.verdict} · {p.score}
              </span>
            ))}
          </div>
          {d.status === "proposed" && (
            <div className="flex gap-2">
              <button
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() =>
                  onRun({
                    label: "批准部署方案",
                    run: () =>
                      reviewContentOpsDecision({
                        data: {
                          ...scope,
                          decisionId: d.id,
                          action: "approve",
                        },
                      }),
                  })
                }
              >
                批准并创建内容任务
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() =>
                  onRun({
                    label: "驳回部署方案",
                    run: () =>
                      reviewContentOpsDecision({
                        data: {
                          ...scope,
                          decisionId: d.id,
                          action: "reject",
                        },
                      }),
                  })
                }
              >
                驳回
              </button>
            </div>
          )}
        </section>
      ))}
      {["decided", "brief_ready"].includes(topic.cluster.status) && (
        <button className="btn btn-primary btn-sm" onClick={() => onContinue()}>
          继续取材与证据审核 →
        </button>
      )}
    </>
  );
}
