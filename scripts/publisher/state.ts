// Publisher state and per-site locks, both under SITES_DIR/.publisher/. Each
// repository has its own state file, read and written only while its lock is
// held, so concurrent runs on different sites never overwrite each other.

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";

const MAX_REMEMBERED = 500;

const repoStateSchema = z.object({
  // Last origin/<production> sha that was checked for unapproved changes.
  lastSha: z.string(),
  // Commits this publisher pushed (publish squash commits and reverts).
  ownShas: z.array(z.string()).default([]),
  // Approvals this publisher already pushed for.
  handledApprovals: z.array(z.string()).default([]),
});
const stateSchema = z.object({
  repos: z.record(z.string(), repoStateSchema).default({}),
});

export type RepoState = z.infer<typeof repoStateSchema>;
export type PublisherState = z.infer<typeof stateSchema>;

export const publisherDir = (sitesDir: string) =>
  path.join(sitesDir, ".publisher");

const repoStateFile = (sitesDir: string, repoName: string) =>
  path.join(publisherDir(sitesDir), "state", `${repoName}.json`);

/** A repository's state from disk. Call it while holding the repository's lock. */
export function loadRepoState(
  sitesDir: string,
  repoName: string,
): RepoState | undefined {
  const file = repoStateFile(sitesDir, repoName);
  if (existsSync(file)) {
    return repoStateSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  }
  // Older publishers kept every repository in one shared file.
  const shared = path.join(publisherDir(sitesDir), "state.json");
  if (!existsSync(shared)) return undefined;
  return stateSchema.parse(JSON.parse(readFileSync(shared, "utf8"))).repos[
    repoName
  ];
}

/** Write a repository's state. Call it while holding the repository's lock. */
export function saveRepoState(
  sitesDir: string,
  repoName: string,
  state: RepoState,
) {
  const file = repoStateFile(sitesDir, repoName);
  mkdirSync(path.dirname(file), { recursive: true });
  const next = {
    ...state,
    ownShas: state.ownShas.slice(-MAX_REMEMBERED),
    handledApprovals: state.handledApprovals.slice(-MAX_REMEMBERED),
  };
  writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2));
  renameSync(`${file}.tmp`, file);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Exclusive per-repository lock file. Returns a release function, or null when
 * another live run holds it. A lock left by a dead process is taken over.
 */
export function acquireLock(
  sitesDir: string,
  repoName: string,
): (() => void) | null {
  const dir = publisherDir(sitesDir);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${repoName}.lock`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return () => rmSync(file, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = Number.parseInt(readFileSync(file, "utf8"), 10);
      if (Number.isInteger(owner) && pidAlive(owner)) return null;
      rmSync(file, { force: true });
    }
  }
  return null;
}
