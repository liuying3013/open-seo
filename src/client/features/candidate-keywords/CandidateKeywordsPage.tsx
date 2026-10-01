import type { RowSelectionState, SortingState } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  TableBulkActionBar,
  TableBulkActionButton,
} from "@/client/components/table/TableBulkActionBar";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { normalizeExportValue } from "@/client/lib/csv";
import {
  listCandidateKeywords,
  removeCandidateKeywords,
  saveCandidateKeywords,
} from "@/serverFunctions/keywords";
import type { CandidateKeywordRow } from "@/types/keywords";
import { CandidateKeywordsAddForm } from "./CandidateKeywordsAddForm";
import { CandidateKeywordsHeader } from "./CandidateKeywordsHeader";
import {
  CandidateKeywordsPagination,
  CandidateKeywordsToolbar,
  DeleteCandidatesModal,
} from "./CandidateKeywordsParts";
import { CandidateKeywordsTable } from "./CandidateKeywordsTable";
import {
  countBySource,
  EMPTY_CANDIDATE_ROWS,
  filterCandidateRows,
  parseCandidateDraft,
  type CandidatePageSize,
} from "./candidateKeywordsUtils";

export function CandidateKeywordsPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [source, setSource] = useState<"competitor" | "manual">("competitor");
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<CandidatePageSize>(50);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);
  const [showConfirm, setShowConfirm] = useState(false);

  const query = useQuery<{ rows: CandidateKeywordRow[] }>({
    queryKey: ["candidate-keywords", projectId],
    queryFn: () => listCandidateKeywords({ data: { projectId } }),
  });
  const rows = query.data?.rows ?? EMPTY_CANDIDATE_ROWS;
  const parsedDraft = useMemo(() => parseCandidateDraft(draft), [draft]);
  const sourceOptions = useMemo(() => countBySource(rows), [rows]);
  const filteredRows = useMemo(
    () => filterCandidateRows(rows, search, sourceFilter),
    [rows, search, sourceFilter],
  );
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(
    () => filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredRows, pageSize, safePage],
  );
  const hasActiveFilters = search.trim().length > 0 || sourceFilter !== "all";
  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection],
  );
  const clearFilters = () => {
    setSearch("");
    setSourceFilter("all");
    setPage(1);
  };

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    if (!showAdd) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowAdd(false);
      setDraft("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAdd]);

  useEffect(() => {
    setSearch("");
    setSourceFilter("all");
    setPage(1);
    setRowSelection({});
    setShowAdd(false);
    setDraft("");
    setShowConfirm(false);
  }, [projectId]);

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["candidate-keywords", projectId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["candidate-keyword-counts"],
    });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      saveCandidateKeywords({
        data: { projectId, keywords: parsedDraft, source },
      }),
    onSuccess: (result) => {
      setDraft("");
      setRowSelection({});
      setShowAdd(false);
      toast.success(`Saved ${result.savedCount} candidate keyword(s).`);
      invalidate();
    },
    onError: (error) => {
      toast.error(getStandardErrorMessage(error));
    },
  });

  const removeMutation = useMutation({
    mutationFn: () =>
      removeCandidateKeywords({
        data: { projectId, candidateKeywordIds: selectedIds },
      }),
    onSuccess: (result) => {
      setRowSelection({});
      setShowConfirm(false);
      toast.success(`Removed ${result.deletedCount} candidate keyword(s).`);
      invalidate();
    },
    onError: (error) => {
      toast.error(getStandardErrorMessage(error));
    },
  });

  const copySelected = async () => {
    const selected = new Set(selectedIds);
    const keywords = filteredRows
      .filter((row) => selected.has(row.id))
      .map((row) => String(normalizeExportValue(row.keyword)));
    try {
      await navigator.clipboard.writeText(keywords.join("\n"));
      toast.success(
        `Copied ${keywords.length} ${keywords.length === 1 ? "keyword" : "keywords"}`,
      );
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <CandidateKeywordsHeader
          projectId={projectId}
          keywordCount={rows.length}
          isLoading={query.isLoading}
          showAdd={showAdd}
          onToggleAdd={() => setShowAdd((open) => !open)}
        />

        {showAdd ? (
          <CandidateKeywordsAddForm
            draft={draft}
            source={source}
            parsedCount={parsedDraft.length}
            isPending={saveMutation.isPending}
            onDraftChange={setDraft}
            onSourceChange={setSource}
            onSubmit={() => saveMutation.mutate()}
            onCancel={() => {
              setShowAdd(false);
              setDraft("");
            }}
          />
        ) : null}

        <div className="overflow-hidden rounded-lg border border-base-300 bg-base-100">
          <CandidateKeywordsToolbar
            search={search}
            sourceOptions={sourceOptions}
            sourceFilter={sourceFilter}
            filteredCount={filteredRows.length}
            totalCount={rows.length}
            hasActiveFilters={hasActiveFilters}
            isRefreshing={query.isFetching && !query.isLoading}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            onSourceFilterChange={(value) => {
              setSourceFilter(value);
              setPage(1);
            }}
            onClearFilters={clearFilters}
          />
          <div className="p-2 sm:p-4">
            <CandidateKeywordsTable
              rows={pagedRows}
              rowSelection={rowSelection}
              sorting={sorting}
              isLoading={query.isLoading}
              hasActiveFilters={hasActiveFilters}
              onRowSelectionChange={setRowSelection}
              onSortingChange={setSorting}
              onAdd={() => setShowAdd(true)}
              onClearFilters={clearFilters}
            />
          </div>
          {filteredRows.length > 0 ? (
            <CandidateKeywordsPagination
              page={safePage}
              pageSize={pageSize}
              totalCount={filteredRows.length}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setPageSize(next);
                setPage(1);
              }}
            />
          ) : null}
        </div>

        <TableBulkActionBar
          selectedCount={selectedIds.length}
          onClear={() => setRowSelection({})}
          actions={
            <>
              <div className="flex items-center gap-0.5 px-1.5">
                <TableBulkActionButton
                  icon={<Copy className="size-3.5" />}
                  onClick={() => void copySelected()}
                >
                  Copy
                </TableBulkActionButton>
              </div>
              <div className="flex items-center border-l border-base-content/10 px-1.5">
                <TableBulkActionButton
                  icon={<Trash2 className="size-3.5" />}
                  onClick={() => setShowConfirm(true)}
                  variant="danger"
                >
                  Delete
                </TableBulkActionButton>
              </div>
            </>
          }
        />

        {showConfirm ? (
          <DeleteCandidatesModal
            selectedCount={selectedIds.length}
            isPending={removeMutation.isPending}
            onClose={() => setShowConfirm(false)}
            onConfirm={() => removeMutation.mutate()}
          />
        ) : null}
      </div>
    </div>
  );
}
