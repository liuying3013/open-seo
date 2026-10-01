// Publisher state file and per-site lock, both under SITES_DIR/.publisher/.

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

export function loadState(sitesDir: string): PublisherState {
  const file = path.join(publisherDir(sitesDir), "state.json");
  if (!existsSync(file)) return { repos: {} };
  return stateSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export function saveState(sitesDir: string, state: PublisherState) {
  const dir = publisherDir(sitesDir);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "state.json");
  const next = structuredClone(state);
  for (const repo of Object.values(next.repos)) {
    repo.ownShas = repo.ownShas.slice(-MAX_REMEMBERED);
    repo.handledApprovals = repo.handledApprovals.slice(-MAX_REMEMBERED);
  }
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
