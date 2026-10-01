import type {
  WorkbenchTopic,
  WorkbenchTask,
  WorkbenchAction,
} from "./workbenchTypes";
import { Markdown } from "@/client/components/Markdown";
import { parseStored } from "./workbenchParsing";
import { approveContentOpsEvidencePack } from "@/serverFunctions/content-ops";
import { evidencePackContentSchema } from "@/server/features/content-ops/prompts/evidencePack";
export function WorkbenchEvidence({
  topic,
  busy,
  onRun,
  action,
  onContinue,
}: {
  topic: WorkbenchTopic;
  busy: boolean;
  onRun: (task: WorkbenchTask) => void;
  action: WorkbenchAction;
  onContinue: () => void;
}) {
  const scope = {
    projectId: topic.cluster.projectId,
    clusterId: topic.cluster.id,
  };
  const pack = parseStored(
    evidencePackContentSchema,
    topic.pack?.content ?? null,
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">阅读排名页正文</h3>
          <p className="mt-1 text-sm text-base-content/60">
            取材使用真实正文；失败页面会保留记录，不补写未知事实。
          </p>
        </div>
        <button
          className="btn btn-sm btn-outline"
          disabled={
            busy || !["decided", "brief_ready"].includes(topic.cluster.status)
          }
          onClick={() => action("读取排名页正文", "read_pages")}
        >
          读取排名页
        </button>
      </div>
      {!topic.pages.length && (
        <p className="text-sm text-base-content/60">
          批准部署方案后可开始取材。14 天内的可用正文会复用。
        </p>
      )}
      {topic.pages.map((p) => (
        <details key={p.id} className="rounded-lg border border-base-300 p-3">
          <summary className="cursor-pointer text-sm">
            {p.title || p.url}
            <span className="ml-2 text-xs text-base-content/50">
              {p.fetchStatus === "ok" ? `${p.wordCount ?? 0} 词` : "读取失败"} ·{" "}
              {p.fetchedAt.slice(0, 10)}
            </span>
          </summary>
          <div className="mt-2">
            <Markdown>{`[查看原文](${p.url})`}</Markdown>
            <p className="mt-2 whitespace-pre-wrap text-sm text-base-content/70">
              {p.excerpt ?? "没有可用正文，请在证据包中保留信息缺口。"}
            </p>
          </div>
        </details>
      ))}
      <button
        className="btn btn-primary btn-sm"
        disabled={
          busy ||
          topic.pages.length === 0 ||
          topic.assets.some((a) => a.brief || a.draft)
        }
        onClick={() => action("生成证据包", "build_pack", true)}
      >
        {topic.pack ? "重新生成证据包" : "生成证据包"}
      </button>
      {topic.assets.some((a) => a.brief || a.draft) && (
        <p className="text-xs text-base-content/60">
          已有文章使用此证据包，工作台保留该版本以维持可追溯性。
        </p>
      )}
      {topic.pack && pack && (
        <section className="space-y-4 border-t border-base-300 pt-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">证据包 v{topic.pack.version}</h3>
            <span className="badge badge-outline">
              {topic.pack.status === "approved" ? "已批准" : "待人工审核"}
            </span>
          </div>
          <h4 className="text-sm font-semibold">可引用事实与来源</h4>
          <ul className="space-y-3">
            {pack.verifiedFacts.map((f, i) => (
              <li key={i} className="border-l-2 border-primary/40 pl-3 text-sm">
                <p>{f.fact}</p>
                <p className="mt-1 break-all text-xs text-base-content/50">
                  来源：{f.source}
                </p>
              </li>
            ))}
          </ul>
          {pack.openQuestions.length > 0 && (
            <div className="rounded-lg bg-warning/10 p-4">
              <h4 className="font-medium text-sm">尚未证实的问题</h4>
              <ul className="mt-2 list-disc pl-4 text-sm space-y-1">
                {pack.openQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs">
                批准后这些问题仍会保留，不能当成事实写入文章。
              </p>
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              规格、差异点与写作边界
            </summary>
            <div className="mt-3 space-y-3 text-sm">
              <Markdown>{pack.specifications}</Markdown>
              <Markdown>{pack.serpFindings}</Markdown>
              <p>{pack.commercialInfo}</p>
              <h4 className="font-semibold">竞品未覆盖的内容</h4>
              <ul className="list-disc pl-4">
                {pack.competitorGaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
              <h4 className="font-semibold">禁止声明</h4>
              <ul className="list-disc pl-4">
                {pack.prohibitedClaims.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          </details>
          {topic.pack.status === "draft" && (
            <button
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() =>
                onRun({
                  label: "批准证据包",
                  run: () =>
                    approveContentOpsEvidencePack({
                      data: {
                        projectId: scope.projectId,
                        packId: topic.pack.id,
                      },
                    }),
                })
              }
            >
              确认事实与缺口，批准证据包
            </button>
          )}
          {topic.pack.status === "approved" && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => onContinue()}
            >
              进入写作 →
            </button>
          )}
        </section>
      )}
      {topic.pack && !pack && (
        <p role="alert" className="text-error text-sm">
          此证据包格式无法解析，暂不能审核。请检查原始记录。
        </p>
      )}
    </>
  );
}
