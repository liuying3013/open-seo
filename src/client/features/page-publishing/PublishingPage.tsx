import { ReviewDetailView, ReviewQueue } from "./ReviewTab";
import { LedgerTab } from "./LedgerTab";

type PublishingTab = "review" | "ledger";

export function PublishingPage({
  projectId,
  tab,
  assetId,
  onChange,
}: {
  projectId: string;
  tab: PublishingTab;
  assetId: string | undefined;
  onChange: (next: { tab: PublishingTab; asset?: string }) => void;
}) {
  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">发布审批</h1>
        <p className="mt-1 text-sm text-base-content/60">
          Claude
          提交的页面内容稿在这里预览、检查并由你批准；批准后由发布器到点发布，结果记录在发布台账。
        </p>
      </header>
      <div role="tablist" className="tabs tabs-bordered">
        <button
          type="button"
          role="tab"
          className={`tab ${tab === "review" ? "tab-active" : ""}`}
          onClick={() => onChange({ tab: "review" })}
        >
          发布审批
        </button>
        <button
          type="button"
          role="tab"
          className={`tab ${tab === "ledger" ? "tab-active" : ""}`}
          onClick={() => onChange({ tab: "ledger" })}
        >
          发布台账
        </button>
      </div>
      {tab === "ledger" ? (
        <LedgerTab projectId={projectId} />
      ) : assetId ? (
        <ReviewDetailView
          key={assetId}
          projectId={projectId}
          assetId={assetId}
          onBack={() => onChange({ tab: "review" })}
        />
      ) : (
        <ReviewQueue
          projectId={projectId}
          onSelect={(asset) => onChange({ tab: "review", asset })}
        />
      )}
    </div>
  );
}
