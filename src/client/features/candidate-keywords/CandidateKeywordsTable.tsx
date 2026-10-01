import {
  createColumnHelper,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { Search } from "lucide-react";
import { useMemo } from "react";
import {
  AppDataTable,
  makeSelectionColumn,
  useAppTable,
  useSelectionAnchor,
} from "@/client/components/table/AppDataTable";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import type { CandidateKeywordRow } from "@/types/keywords";
import {
  formatAddedOn,
  sourceBadgeClass,
  sourceLabel,
} from "./candidateKeywordsUtils";

const columnHelper = createColumnHelper<CandidateKeywordRow>();

export function CandidateKeywordsTable({
  rows,
  rowSelection,
  sorting,
  isLoading,
  hasActiveFilters,
  onRowSelectionChange,
  onSortingChange,
  onAdd,
  onClearFilters,
}: {
  rows: CandidateKeywordRow[];
  rowSelection: RowSelectionState;
  sorting: SortingState;
  isLoading: boolean;
  hasActiveFilters: boolean;
  onRowSelectionChange: OnChangeFn<RowSelectionState>;
  onSortingChange: OnChangeFn<SortingState>;
  onAdd: () => void;
  onClearFilters: () => void;
}) {
  const selectAnchorRef = useSelectionAnchor();
  const columns = useMemo<ColumnDef<CandidateKeywordRow>[]>(
    () => [
      makeSelectionColumn<CandidateKeywordRow>(selectAnchorRef),
      columnHelper.accessor("keyword", {
        header: ({ column }) => (
          <SortableHeader column={column} label="Keyword" />
        ),
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue()}</span>
        ),
      }),
      columnHelper.accessor("source", {
        header: ({ column }) => (
          <SortableHeader column={column} label="Source" />
        ),
        cell: ({ getValue }) => {
          const source = getValue();
          return (
            <span
              className={`badge badge-sm font-normal ${sourceBadgeClass(source)}`}
            >
              {sourceLabel(source)}
            </span>
          );
        },
      }),
      columnHelper.accessor("createdAt", {
        header: ({ column }) => (
          <SortableHeader column={column} label="Added" />
        ),
        cell: ({ getValue }) => (
          <span className="text-base-content/60">
            {formatAddedOn(getValue())}
          </span>
        ),
        meta: { headerClassName: "w-32", cellClassName: "whitespace-nowrap" },
      }),
    ],
    [selectAnchorRef],
  );

  const table = useAppTable({
    data: rows,
    columns,
    state: { rowSelection, sorting },
    onRowSelectionChange,
    onSortingChange,
    getRowId: (row) => row.id,
    enableRowSelection: true,
    withSorting: true,
  });

  return (
    <AppDataTable
      table={table}
      className="table table-sm"
      isLoading={isLoading}
      loading={
        <div className="py-12 text-center text-sm text-base-content/55">
          Loading candidates…
        </div>
      }
      empty={
        <EmptyState
          hasActiveFilters={hasActiveFilters}
          onAdd={onAdd}
          onClearFilters={onClearFilters}
        />
      }
    />
  );
}

function EmptyState({
  hasActiveFilters,
  onAdd,
  onClearFilters,
}: {
  hasActiveFilters: boolean;
  onAdd: () => void;
  onClearFilters: () => void;
}) {
  return (
    <div className="py-12 text-center text-sm text-base-content/55">
      <Search className="mx-auto mb-2 size-8 opacity-40" />
      {hasActiveFilters ? (
        <div className="space-y-3">
          <p>No candidate keywords match the current filters.</p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClearFilters}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p>
            No candidate keywords yet. Paste a shortlist to start Content Ops.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onAdd}
          >
            Add keywords
          </button>
        </div>
      )}
    </div>
  );
}
