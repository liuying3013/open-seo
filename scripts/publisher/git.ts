// Git operations of the publisher. Everything here shells out to the git CLI
// so the commits are exactly what a person would get from the same commands.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const TEMP_BRANCH = "publisher/tmp";

export class GitError extends Error {}

function run(cwd: string, args: string[], input?: Buffer) {
  const result = spawnSync("git", args, {
    cwd,
    input,
    maxBuffer: 512 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8").trim(),
  };
}

export function git(cwd: string, args: string[]): string {
  const result = run(cwd, args);
  if (!result.ok) {
    throw new GitError(`git ${args.join(" ")}: ${result.stderr}`);
  }
  return result.stdout.toString("utf8").trim();
}

function gitOk(cwd: string, args: string[]): boolean {
  return run(cwd, args).ok;
}

/**
 * `git diff --binary -U0 <range> | git patch-id --stable`, first column. Null
 * when the diff is empty. Without context lines the fingerprint covers exactly
 * the lines a change adds and removes, so it survives a rebase onto a
 * production branch that changed neighbouring lines. `context` reproduces
 * fingerprints taken with git's default three lines.
 */
export function patchId(
  cwd: string,
  range: string,
  { context = 0 }: { context?: number } = {},
): string | null {
  const diff = run(cwd, ["diff", "--binary", `-U${context}`, range]);
  if (!diff.ok) throw new GitError(`git diff ${range}: ${diff.stderr}`);
  if (diff.stdout.length === 0) return null;
  const out = run(cwd, ["patch-id", "--stable"], diff.stdout);
  if (!out.ok) throw new GitError(`git patch-id: ${out.stderr}`);
  return out.stdout.toString("utf8").trim().split(/\s+/)[0] || null;
}

// Versions fingerprinted with git's default context still match.
function matchesApproved(cwd: string, range: string, approved: string) {
  return (
    patchId(cwd, range) === approved ||
    patchId(cwd, range, { context: 3 }) === approved
  );
}

/** The publisher's own checkout of the clone, reset to `ref` (detached). */
function resetWorktree(repoDir: string, worktreeDir: string, ref: string) {
  git(repoDir, ["worktree", "prune"]);
  if (!existsSync(worktreeDir)) {
    git(repoDir, ["worktree", "add", "--detach", worktreeDir, ref]);
    return;
  }
  // A previous run may have died mid-rebase / mid-revert.
  run(worktreeDir, ["rebase", "--abort"]);
  run(worktreeDir, ["revert", "--abort"]);
  run(worktreeDir, ["merge", "--abort"]);
  git(worktreeDir, ["checkout", "--detach", "--force", ref]);
  git(worktreeDir, ["reset", "--hard", ref]);
  git(worktreeDir, ["clean", "-fd"]);
}

type PrepareInput = {
  repoDir: string;
  worktreeDir: string;
  productionBranch: string;
  taskBranch: string;
  approvedPatchId: string;
  // The task branch head the approved version was submitted with.
  approvedHeadCommit?: string | null;
  commitMessage: string;
};

export type PrepareResult =
  | { ok: true; commit: string }
  | { ok: false; stage: "merge" | "fingerprint"; message: string };

/**
 * Rebase the task branch onto origin/<production>, check that it still carries
 * the approved change, then build ONE squash commit on origin/<production>
 * holding exactly the rebased change, so a rollback only ever needs to revert
 * that single commit. Nothing is pushed.
 */
export function prepareSquashCommit(input: PrepareInput): PrepareResult {
  const { repoDir, worktreeDir, productionBranch, taskBranch } = input;
  const base = `origin/${productionBranch}`;
  const taskRef = [
    `refs/heads/${taskBranch}`,
    `refs/remotes/origin/${taskBranch}`,
  ].find((ref) => gitOk(repoDir, ["rev-parse", "--verify", "--quiet", ref]));
  if (!taskRef) {
    return {
      ok: false,
      stage: "merge",
      message: `Task branch ${taskBranch} not found in the local clone.`,
    };
  }

  try {
    resetWorktree(repoDir, worktreeDir, base);
    git(worktreeDir, ["checkout", "-B", TEMP_BRANCH, taskRef]);
    // A branch still at the approved head carries exactly the approved change,
    // so a clean rebase needs no fingerprint. That matters because diff
    // alignment, and with it the patch id, can shift when other changes landed
    // in the same file.
    const approvedHead = input.approvedHeadCommit?.toLowerCase();
    const atApprovedHead =
      !!approvedHead &&
      git(worktreeDir, ["rev-parse", "HEAD"]).startsWith(approvedHead);
    const rebase = run(worktreeDir, ["rebase", base]);
    if (!rebase.ok) {
      run(worktreeDir, ["rebase", "--abort"]);
      return {
        ok: false,
        stage: "merge",
        message: `Rebase onto ${base} failed: ${rebase.stderr.slice(0, 500)}`,
      };
    }

    const rebased = `${base}...HEAD`;
    if (
      !atApprovedHead &&
      !matchesApproved(worktreeDir, rebased, input.approvedPatchId)
    ) {
      return {
        ok: false,
        stage: "fingerprint",
        message: `Task branch is no longer at the approved commit and its patch id after rebase is ${patchId(worktreeDir, rebased) ?? "empty"}, approved ${input.approvedPatchId}.`,
      };
    }
    const rebasedTree = git(worktreeDir, ["rev-parse", "HEAD^{tree}"]);

    git(worktreeDir, ["checkout", "--detach", "--force", base]);
    git(worktreeDir, ["merge", "--squash", TEMP_BRANCH]);
    git(worktreeDir, ["commit", "--no-verify", "-m", input.commitMessage]);
    const commit = git(worktreeDir, ["rev-parse", "HEAD"]);
    if (git(worktreeDir, ["rev-parse", `${commit}^{tree}`]) !== rebasedTree) {
      return {
        ok: false,
        stage: "fingerprint",
        message: "The squash commit does not match the rebased task branch.",
      };
    }
    return { ok: true, commit };
  } catch (error) {
    return { ok: false, stage: "merge", message: errorMessage(error) };
  } finally {
    run(worktreeDir, ["checkout", "--detach", "--force", base]);
    run(repoDir, ["branch", "-D", TEMP_BRANCH]);
  }
}

/** Revert one commit on top of origin/<production>. Nothing is pushed. */
export function prepareRevert(input: {
  repoDir: string;
  worktreeDir: string;
  productionBranch: string;
  commit: string;
}): { ok: true; commit: string } | { ok: false; message: string } {
  const base = `origin/${input.productionBranch}`;
  try {
    resetWorktree(input.repoDir, input.worktreeDir, base);
    if (
      !gitOk(input.worktreeDir, [
        "merge-base",
        "--is-ancestor",
        input.commit,
        base,
      ])
    ) {
      return {
        ok: false,
        message: `Commit ${input.commit} is not on ${base}.`,
      };
    }
    const revert = run(input.worktreeDir, [
      "revert",
      "--no-edit",
      input.commit,
    ]);
    if (!revert.ok) {
      run(input.worktreeDir, ["revert", "--abort"]);
      return {
        ok: false,
        message: `Revert of ${input.commit} failed: ${revert.stderr.slice(0, 500)}`,
      };
    }
    return { ok: true, commit: git(input.worktreeDir, ["rev-parse", "HEAD"]) };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

/** Plain (never forced) push of a commit to the production branch. */
export function pushCommit(
  cwd: string,
  commit: string,
  productionBranch: string,
): { ok: true } | { ok: false; nonFastForward: boolean; message: string } {
  const result = run(cwd, [
    "push",
    "origin",
    `${commit}:refs/heads/${productionBranch}`,
  ]);
  if (result.ok) return { ok: true };
  return {
    ok: false,
    nonFastForward: /non-fast-forward|fetch first|rejected/i.test(
      result.stderr,
    ),
    message: result.stderr.slice(0, 500),
  };
}

export type CommitInfo = { sha: string; author: string; message: string };

/** Commits in (from, to], oldest first. Null when `from` is not an ancestor of `to`. */
export function commitsBetween(
  cwd: string,
  from: string,
  to: string,
): CommitInfo[] | null {
  if (!gitOk(cwd, ["merge-base", "--is-ancestor", from, to])) return null;
  const out = git(cwd, [
    "log",
    "--reverse",
    "--format=%H%x1f%an%x1f%s",
    `${from}..${to}`,
  ]);
  if (!out) return [];
  return out.split("\n").map((line) => {
    const [sha, author, message] = line.split("\x1f");
    return { sha, author, message };
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
