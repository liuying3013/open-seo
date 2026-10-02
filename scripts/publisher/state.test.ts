import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRepoState, saveRepoState } from "./state";

let sitesDir: string;

beforeEach(() => {
  sitesDir = mkdtempSync(path.join(tmpdir(), "publisher-state-"));
});

afterEach(() => {
  rmSync(sitesDir, { recursive: true, force: true });
});

const state = (lastSha: string) => ({
  lastSha,
  ownShas: [lastSha],
  handledApprovals: [],
});

describe("repository state", () => {
  it("keeps each repository's state apart and reads the older shared file", () => {
    mkdirSync(path.join(sitesDir, ".publisher"));
    writeFileSync(
      path.join(sitesDir, ".publisher", "state.json"),
      JSON.stringify({ repos: { site: state("old") } }),
    );
    expect(loadRepoState(sitesDir, "site")?.lastSha).toBe("old");

    saveRepoState(sitesDir, "site", state("new"));
    saveRepoState(sitesDir, "other", state("other"));
    expect(loadRepoState(sitesDir, "site")?.lastSha).toBe("new");
    expect(loadRepoState(sitesDir, "other")?.ownShas).toEqual(["other"]);
  });
});
