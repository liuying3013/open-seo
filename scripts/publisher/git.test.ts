import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  git,
  patchId,
  prepareRevert,
  prepareSquashCommit,
  pushCommit,
} from "./git";

let root: string;
let origin: string;
let clone: string;
let worktree: string;

function commitFile(
  dir: string,
  file: string,
  content: string,
  message: string,
) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", message]);
}

// Task branch with two commits adding a page, based on the initial main.
function makeTaskBranch() {
  git(clone, ["checkout", "-b", "task/page"]);
  commitFile(clone, "content/new.md", "# New page\n\nline one\n", "add page");
  commitFile(
    clone,
    "content/new.md",
    "# New page\n\nline one\nline two\n",
    "tweak",
  );
  const approved = patchId(clone, "origin/main...HEAD");
  git(clone, ["checkout", "main"]);
  return approved;
}

const prepare = (approvedPatchId: string | null, approvedHeadCommit?: string) =>
  prepareSquashCommit({
    repoDir: clone,
    worktreeDir: worktree,
    productionBranch: "main",
    taskBranch: "task/page",
    approvedPatchId: approvedPatchId ?? "none",
    approvedHeadCommit,
    commitMessage: "Publish: New page (asset a1 v1)",
  });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "publisher-git-"));
  origin = path.join(root, "origin.git");
  clone = path.join(root, "clone");
  worktree = path.join(root, ".publisher", "clone");
  execFileSync("git", ["init", "--bare", "-b", "main", origin]);
  execFileSync("git", ["init", "-b", "main", clone], { stdio: "ignore" });
  git(clone, ["remote", "add", "origin", origin]);
  git(clone, ["config", "user.email", "t@example.com"]);
  git(clone, ["config", "user.name", "Tester"]);
  git(clone, ["config", "commit.gpgsign", "false"]);
  commitFile(clone, "README.md", "hello\n", "init");
  git(clone, ["push", "origin", "main"]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("prepareSquashCommit", () => {
  it("builds one commit whose fingerprint equals the approved one, even after origin moved on", () => {
    const approved = makeTaskBranch();
    // Someone else lands an unrelated change on main in the meantime.
    commitFile(clone, "other.txt", "x\n", "unrelated");
    git(clone, ["push", "origin", "main"]);
    git(clone, ["fetch", "origin"]);

    const result = prepare(approved);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      git(worktree, ["rev-list", "--count", `origin/main..${result.commit}`]),
    ).toBe("1");
    expect(patchId(worktree, `${result.commit}^..${result.commit}`)).toBe(
      approved,
    );

    expect(pushCommit(worktree, result.commit, "main")).toEqual({ ok: true });
    expect(git(origin, ["log", "-1", "--format=%s", "main"])).toBe(
      "Publish: New page (asset a1 v1)",
    );
  });

  it("keeps the fingerprint when origin changed a line next to the change", () => {
    commitFile(clone, "list.md", "a\nb\nc\nd\ne\n", "list");
    git(clone, ["push", "origin", "main"]);
    git(clone, ["checkout", "-b", "task/page"]);
    commitFile(clone, "list.md", "a\nb\nc\nd\nE\n", "task edit");
    const approved = patchId(clone, "origin/main...HEAD");
    const approvedWithContext = patchId(clone, "origin/main...HEAD", {
      context: 3,
    });
    git(clone, ["checkout", "main"]);
    // An earlier publish changed a line inside git's default diff context.
    commitFile(clone, "list.md", "a\nb\nC\nd\ne\n", "neighbour");
    git(clone, ["push", "origin", "main"]);
    git(clone, ["fetch", "origin"]);

    expect(prepare(approved)).toMatchObject({ ok: true });
    expect(prepare(approvedWithContext)).toMatchObject({
      ok: false,
      stage: "fingerprint",
    });
  });

  it("rebases the branch's net change, ignoring commits it later undid", () => {
    commitFile(clone, "list.md", "a\nb\nc\n", "list");
    git(clone, ["push", "origin", "main"]);
    git(clone, ["checkout", "-b", "task/page"]);
    commitFile(clone, "list.md", "a\nB\nc\n", "try an edit");
    commitFile(clone, "list.md", "a\nb\nc\nd\n", "undo it, add d");
    const approvedHead = git(clone, ["rev-parse", "HEAD"]);
    git(clone, ["checkout", "main"]);
    commitFile(clone, "list.md", "a\nX\nc\n", "production edit");
    git(clone, ["push", "origin", "main"]);
    git(clone, ["fetch", "origin"]);

    const result = prepare(null, approvedHead);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(git(worktree, ["show", `${result.commit}:list.md`])).toBe(
      "a\nX\nc\nd",
    );
  });

  it("publishes a branch still at the approved head even when its patch id shifted", () => {
    makeTaskBranch();
    const approvedHead = git(clone, ["rev-parse", "task/page"]);
    git(clone, ["fetch", "origin"]);

    expect(prepare("0000000", approvedHead)).toMatchObject({ ok: true });
  });

  it("stops with a fingerprint failure when the branch content changed after approval", () => {
    const approved = makeTaskBranch();
    const approvedHead = git(clone, ["rev-parse", "task/page"]);
    git(clone, ["checkout", "task/page"]);
    commitFile(clone, "content/new.md", "# New page\n\nsneaky edit\n", "edit");
    git(clone, ["checkout", "main"]);
    git(clone, ["fetch", "origin"]);

    const result = prepare(approved, approvedHead);
    expect(result).toMatchObject({ ok: false, stage: "fingerprint" });
  });

  it("stops with a merge failure on conflicting changes", () => {
    const approved = makeTaskBranch();
    commitFile(clone, "content/new.md", "# Conflicting\n", "conflict on main");
    git(clone, ["push", "origin", "main"]);
    git(clone, ["fetch", "origin"]);

    expect(prepare(approved)).toMatchObject({ ok: false, stage: "merge" });
  });
});

describe("prepareRevert", () => {
  it("reverts only the publish commit and leaves later commits alone", () => {
    const approved = makeTaskBranch();
    git(clone, ["fetch", "origin"]);
    const published = prepare(approved);
    if (!published.ok) throw new Error(published.message);
    pushCommit(worktree, published.commit, "main");
    commitFile(clone, "later.txt", "later\n", "later change");
    git(clone, ["pull", "--no-rebase", "--no-edit", "origin", "main"]);
    git(clone, ["push", "origin", "main"]);
    git(clone, ["fetch", "origin"]);

    const reverted = prepareRevert({
      repoDir: clone,
      worktreeDir: worktree,
      productionBranch: "main",
      commit: published.commit,
    });
    expect(reverted.ok).toBe(true);
    expect(git(worktree, ["ls-files"]).split("\n").sort()).toEqual([
      "README.md",
      "later.txt",
    ]);
  });
});
