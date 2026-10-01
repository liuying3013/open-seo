import { ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { Modal } from "@/client/components/Modal";
import {
  CANDIDATE_PAGE_SIZES,
  sourceLabel,
  type CandidatePageSize,
} from "./candidateKeywordsUtils";

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-xs gap-1 ${active ? "btn-active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function CandidateKeywordsToolbar({
  search,
  sourceOptions,
  sourceFilter,
  filteredCount,
  totalCount,
  hasActiveFilters,
  isRefreshing,
  onSearchChange,
  onSourceFilterChange,
  onClearFilters,
}: {
  search: string;
  sourceOptions: Array<[string, number]>;
  sourceFilter: string;
  filteredCount: number;
  totalCount: number;
  hasActiveFilters: boolean;
  isRefreshing: boolean;
  onSearchChange: (value: string) => void;
  onSourceFilterChange: (value: string) => void;
  onClearFilters: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-base-300 px-4 py-2.5">
      <label className="input input-sm !w-56 shrink-0">
        <Search className="size-3.5 shrink-0 text-base-content/40" />
        <input
          type="text"
          className="grow"
          placeholder="Search keywords"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        {search ? (
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            aria-label="Clear search"
            onClick={() => onSearchChange("")}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </label>
      <SourceFilterChips
        options={sourceOptions}
        value={sourceFilter}
        onChange={onSourceFilterChange}
      />
      {hasActiveFilters ? (
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={onClearFilters}
        >
          Clear
        </button>
      ) : null}
      <span className="ml-auto text-xs tabular-nums text-base-content/60">
        {hasActiveFilters
          ? `${filteredCount.toLocaleString()} of ${totalCount.toLocaleString()}`
          : `${totalCount.toLocaleString()} candidate${totalCount === 1 ? "" : "s"}`}
        {isRefreshing ? (
          <Loader2 className="ml-2 inline size-3 animate-spin" />
        ) : null}
      </span>
    </div>
  );
}

function SourceFilterChips({
  options,
  value,
  onChange,
}: {
  options: Array<[string, number]>;
  value: string;
  onChange: (value: string) => void;
}) {
  if (options.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <FilterChip active={value === "all"} onClick={() => onChange("all")}>
        All
      </FilterChip>
      {options.map(([key, count]) => (
        <FilterChip
          key={key}
          active={value === key}
          onClick={() => onChange(key)}
        >
          {sourceLabel(key === "unknown" ? null : key)}
          <span className="tabular-nums opacity-60">{count}</span>
        </FilterChip>
      ))}
    </div>
  );
}

export function CandidateKeywordsPagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: CandidatePageSize;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: CandidatePageSize) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(totalCount, page * pageSize);

  return (
    <div className="flex flex-col gap-3 border-t border-base-300 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm tabular-nums text-base-content/70">
        {start.toLocaleString()}-{end.toLocaleString()} of{" "}
        {totalCount.toLocaleString()}
      </span>
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-base-content/70">
          <span className="whitespace-nowrap">Rows per page</span>
          <select
            className="select select-bordered select-sm w-20"
            value={pageSize}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              onPageSizeChange(
                CANDIDATE_PAGE_SIZES.find((size) => size === parsed) ?? 50,
              );
            }}
          >
            {CANDIDATE_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-sm tabular-nums text-base-content/70">
            Page {page.toLocaleString()} of {totalPages.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-square"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-square"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DeleteCandidatesModal({
  selectedCount,
  isPending,
  onClose,
  onConfirm,
}: {
  selectedCount: number;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal onClose={onClose} labelledBy="delete-candidates-title">
      <h3 id="delete-candidates-title" className="text-lg font-semibold">
        Delete keywords?
      </h3>
      <p className="text-sm text-base-content/70">
        This will permanently delete {selectedCount} candidate keyword
        {selectedCount !== 1 ? "s" : ""}.
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-error btn-sm gap-1"
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending ? <Loader2 className="size-3 animate-spin" /> : null}
          Delete {selectedCount} keyword
          {selectedCount !== 1 ? "s" : ""}
        </button>
      </div>
    </Modal>
  );
}
