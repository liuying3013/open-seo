import { Loader2 } from "lucide-react";

type CandidateSource = "competitor" | "manual";

export function CandidateKeywordsAddForm({
  draft,
  source,
  parsedCount,
  isPending,
  onDraftChange,
  onSourceChange,
  onSubmit,
  onCancel,
}: {
  draft: string;
  source: CandidateSource;
  parsedCount: number;
  isPending: boolean;
  onDraftChange: (value: string) => void;
  onSourceChange: (value: CandidateSource) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="space-y-3 rounded-lg border border-base-300 bg-base-100 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsedCount === 0) return;
        onSubmit();
      }}
    >
      <label className="form-control">
        <span className="label-text mb-1">Paste one keyword per line</span>
        <textarea
          className="textarea textarea-bordered min-h-28 font-mono text-sm"
          placeholder={
            "flexible mcm panel\nmcm vs pu stone\nfreeze thaw flexible stone"
          }
          value={draft}
          autoFocus
          onChange={(event) => onDraftChange(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-base-content/70">Source</span>
          <select
            className="select select-bordered select-sm"
            value={source}
            onChange={(event) =>
              onSourceChange(
                event.target.value === "manual" ? "manual" : "competitor",
              )
            }
          >
            <option value="competitor">Competitor</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={parsedCount === 0 || isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Saving…
            </>
          ) : parsedCount > 0 ? (
            `Save ${parsedCount}`
          ) : (
            "Save"
          )}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
