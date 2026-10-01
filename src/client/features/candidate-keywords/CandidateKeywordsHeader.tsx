import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { ProjectSummary } from "@/client/features/projects/types";
import { setLastProjectId } from "@/client/lib/active-project";
import { getCandidateKeywordCounts } from "@/serverFunctions/keywords";
import { getProjects } from "@/serverFunctions/projects";

const TAB_LIMIT = 8;

function projectCount(
  id: string,
  activeProjectId: string,
  activeCount: number,
  counts: Map<string, number>,
) {
  if (id === activeProjectId) return activeCount;
  return counts.get(id) ?? 0;
}

export function CandidateKeywordsHeader({
  projectId,
  keywordCount,
  isLoading,
  showAdd,
  onToggleAdd,
}: {
  projectId: string;
  keywordCount: number;
  isLoading: boolean;
  showAdd: boolean;
  onToggleAdd: () => void;
}) {
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(),
  });
  const countsQuery = useQuery({
    queryKey: ["candidate-keyword-counts"],
    queryFn: () => getCandidateKeywordCounts(),
  });
  const projects = projectsQuery.data ?? [];
  const counts = new Map(
    (countsQuery.data ?? []).map((row) => [row.projectId, row.count]),
  );
  const activeProject =
    projects.find((project) => project.id === projectId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">Candidate Keywords</h1>
            <span className="badge badge-neutral badge-lg tabular-nums">
              {isLoading
                ? "…"
                : `${keywordCount.toLocaleString()} keyword${keywordCount === 1 ? "" : "s"}`}
            </span>
          </div>
          <p className="mt-1 text-sm text-base-content/70">
            {activeProject ? (
              <>
                <span className="font-medium text-base-content">
                  {activeProject.name}
                </span>
                {activeProject.domain ? (
                  <span className="text-base-content/50">
                    {" "}
                    · {activeProject.domain}
                  </span>
                ) : null}
                <span> · </span>
              </>
            ) : null}
            Shortlist for{" "}
            <Link
              to="/p/$projectId/content-ops"
              params={{ projectId }}
              className="link link-hover"
            >
              内容工作台
            </Link>
            . Opportunity research stays in{" "}
            <Link
              to="/p/$projectId/saved"
              params={{ projectId }}
              className="link link-hover"
            >
              Saved Keywords
            </Link>
            .
          </p>
        </div>
        <button
          type="button"
          className={`btn btn-primary btn-sm gap-1.5 ${showAdd ? "btn-active" : ""}`}
          onClick={onToggleAdd}
        >
          <Plus className="size-4" />
          Add keywords
        </button>
      </div>
      <CandidateProjectTabs
        projectId={projectId}
        keywordCount={keywordCount}
        projects={projects}
        counts={counts}
      />
    </div>
  );
}

function CandidateProjectTabs({
  projectId,
  keywordCount,
  projects,
  counts,
}: {
  projectId: string;
  keywordCount: number;
  projects: ProjectSummary[];
  counts: Map<string, number>;
}) {
  const navigate = useNavigate();
  if (projects.length === 0) return null;

  if (projects.length > TAB_LIMIT) {
    return (
      <label className="flex items-center gap-2 text-sm">
        <span className="text-base-content/60">Project</span>
        <select
          className="select select-bordered select-sm min-w-48"
          value={projectId}
          aria-label="Switch project"
          onChange={(event) => {
            const nextId = event.target.value;
            setLastProjectId(nextId);
            void navigate({
              to: "/p/$projectId/candidate-keywords",
              params: { projectId: nextId },
            });
          }}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {`${project.name} (${projectCount(project.id, projectId, keywordCount, counts).toLocaleString()})`}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Projects"
      className="tabs tabs-border w-full flex-nowrap overflow-x-auto"
    >
      {projects.map((project) => {
        const count = projectCount(project.id, projectId, keywordCount, counts);
        const active = project.id === projectId;
        return (
          <Link
            key={project.id}
            role="tab"
            aria-selected={active}
            className={`tab shrink-0 gap-1.5 ${active ? "tab-active" : ""}`}
            to="/p/$projectId/candidate-keywords"
            params={{ projectId: project.id }}
            onClick={() => setLastProjectId(project.id)}
          >
            <span className="max-w-[10rem] truncate">{project.name}</span>
            <span className="tabular-nums text-base-content/50">{count}</span>
          </Link>
        );
      })}
    </div>
  );
}
