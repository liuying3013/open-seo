import { sort } from "remeda";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { ClustersRepository } from "@/server/features/content-ops/repositories/ClustersRepository";
import { SerpRepository } from "@/server/features/content-ops/repositories/SerpRepository";
import { BudgetService } from "@/server/features/content-ops/services/BudgetService";
import { ResearchPagesRepository } from "../repositories/ResearchPagesRepository";
import { PageCoverageService } from "./PageCoverageService";
import {
  isActionable,
  scoreTask,
  TASK_POOL_RULE_VERSION,
  type TaskPoolInputs,
} from "../rules/taskPoolRules";

// specs/0013 section 4.3: one pool across every running project, ranked by
// value, with each project's own daily budget deciding what can actually run.
//
// The two are deliberately separate concerns. Ranking is global — a high-value
// task in project B should outrank a mediocre one in project A. Execution is
// per project — and a project that has spent its day must not stall the round.
// So a task whose project is out of budget is SKIPPED and the walk continues,
// with the skip recorded so the operator can see whether a limit needs raising.

type PooledTask = TaskPoolInputs & {
  projectId: string;
  clusterId: string;
  clusterStatus: string;
  coverageVerdict: TaskPoolInputs["coverageVerdict"];
  score: number;
  subscores: Record<string, number>;
  reason: string;
  runnable: boolean;
  blockedBy: string | null;
};

async function build(input: {
  organizationId: string;
  projectIds?: string[];
  limit?: number;
}) {
  const projects = await ProjectRepository.listProjects(input.organizationId);
  const active = input.projectIds
    ? projects.filter((p) => input.projectIds?.includes(p.id))
    : projects;

  const tasks: PooledTask[] = [];
  const budgetByProject = new Map<
    string,
    Awaited<ReturnType<typeof BudgetService.getToday>>
  >();

  for (const project of active) {
    const clusters = await ClustersRepository.listByProject(project.id);
    if (clusters.length === 0) continue;
    budgetByProject.set(project.id, await BudgetService.getToday(project.id));

    for (const cluster of clusters) {
      if (cluster.status === "archived" || cluster.status === "on_hold") {
        continue;
      }
      const [snapshots, pages] = await Promise.all([
        SerpRepository.getLatestForCluster(cluster.id),
        ResearchPagesRepository.getLatestForCluster(cluster.id),
      ]);
      // Coverage needs a site audit; without one every cluster reads as "new",
      // which is the honest default rather than a reason to omit the project.
      let coverageVerdict: TaskPoolInputs["coverageVerdict"] = "new";
      try {
        const coverage = await PageCoverageService.classifyCluster({
          projectId: project.id,
          clusterId: cluster.id,
        });
        coverageVerdict = coverage.verdict;
      } catch {
        coverageVerdict = "new";
      }
      if (!isActionable(coverageVerdict)) continue;

      const hasSerpSnapshots = snapshots.length > 0;
      const pendingSerpFetches =
        !hasSerpSnapshots &&
        (cluster.status === "new" || cluster.status === "pre_scored")
          ? (await ClustersRepository.getKeywords(cluster.id)).filter(
              (keyword) => keyword.isRepresentative,
            ).length
          : 0;
      const inputs: TaskPoolInputs = {
        projectName: project.name,
        clusterName: cluster.name,
        businessValue: cluster.businessValueScore,
        coverageVerdict,
        hasSerpSnapshots,
        hasReadPages: pages.some((page) => page.fetchStatus === "ok"),
        pendingSerpFetches,
      };
      const scored = scoreTask(inputs);
      tasks.push({
        ...inputs,
        projectId: project.id,
        clusterId: cluster.id,
        clusterStatus: cluster.status,
        ...scored,
        runnable: true,
        blockedBy: null,
      });
    }
  }

  // Rank globally, then walk the ranked list applying each task's OWN
  // project's remaining budget. A project running dry removes its tasks from
  // today's run and nothing else.
  const ranked = sort(tasks, (a, b) => b.score - a.score);
  const spent = new Map<string, number>();
  const skippedByProject = new Map<string, number>();

  for (const task of ranked) {
    const budget = budgetByProject.get(task.projectId);
    const serp = budget?.usage.serpFetches;
    const alreadyPlanned = spent.get(task.projectId) ?? 0;
    const remaining =
      serp && serp.limit !== null
        ? serp.limit - serp.used - alreadyPlanned
        : Number.POSITIVE_INFINITY;

    if (task.pendingSerpFetches > remaining) {
      task.runnable = false;
      task.blockedBy = `${task.projectName} has ${Math.max(0, remaining)} SERP fetch(es) left today and this task needs ${task.pendingSerpFetches}`;
      skippedByProject.set(
        task.projectName,
        (skippedByProject.get(task.projectName) ?? 0) + 1,
      );
      continue;
    }
    spent.set(task.projectId, alreadyPlanned + task.pendingSerpFetches);
  }

  const limited = ranked.slice(0, input.limit ?? 20);
  return {
    ruleVersion: TASK_POOL_RULE_VERSION,
    tasks: limited,
    runnable: limited.filter((t) => t.runnable).length,
    skippedForBudget: [...skippedByProject.entries()].map(
      ([projectName, count]) => ({ projectName, count }),
    ),
  };
}

export const TaskPoolService = {
  build,
};
