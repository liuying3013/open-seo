/**
 * Host-side publisher: publishes approved page work orders to site
 * repositories, deploys them through Coolify, verifies the live page and
 * reports back to OpenSEO.
 *
 *   pnpm exec tsx scripts/publisher/run.ts [--project <id>] [--dry-run]
 *
 * Configuration comes from environment variables, see README.md.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "../cli-utils";
import { CoolifyClient } from "./coolify";
import { loadConfig, repoNameOf } from "./config";
import { errorMessage } from "./git";
import { OpenSeoClient } from "./openseo-client";
import { processSite, type RunContext, type SiteJob } from "./site-run";
import { acquireLock, loadState, saveState } from "./state";

const log = (line: string) =>
  console.log(`${new Date().toISOString()} ${line}`);

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args["dry-run"] === "true";
  const onlyProject =
    args.project && args.project !== "true" ? args.project : null;
  const config = loadConfig();

  const ctx: RunContext = {
    openseo: new OpenSeoClient(config.openseoUrl, config.openseoApiKey),
    coolify:
      config.coolifyUrl && config.coolifyToken
        ? new CoolifyClient(config.coolifyUrl, config.coolifyToken)
        : null,
    sitesDir: config.sitesDir,
    dryRun,
    state: loadState(config.sitesDir),
    counts: {
      published: 0,
      rolledBack: 0,
      unverified: 0,
      failed: 0,
      skipped: 0,
    },
    log,
  };

  log(`publisher start${dryRun ? " (dry-run)" : ""}`);
  const sites = await ctx.openseo.listSites();
  let withoutClone = 0;
  let lockedOut = 0;
  let sitesProcessed = 0;

  for (const site of sites) {
    if (onlyProject && site.projectId !== onlyProject) continue;
    const registry = site.registry;
    const repoName = registry?.githubRepo
      ? repoNameOf(registry.githubRepo)
      : null;
    if (!registry || !repoName || !registry.productionBranch) continue;
    if (!existsSync(path.join(config.sitesDir, repoName, ".git"))) {
      withoutClone += 1;
      continue;
    }
    const job: SiteJob = {
      projectId: site.projectId,
      label: site.domain ?? repoName,
      repoName,
      productionBranch: registry.productionBranch,
      autoDeploy: registry.autoDeploy ?? false,
      coolifyAppUuid: registry.coolifyAppUuid ?? null,
    };

    const release = acquireLock(config.sitesDir, repoName);
    if (!release) {
      log(`${job.label}: another run holds the lock, skipped`);
      lockedOut += 1;
      continue;
    }
    try {
      sitesProcessed += 1;
      await processSite(ctx, job);
    } catch (error) {
      ctx.counts.failed += 1;
      log(`${job.label}: FAILED ${errorMessage(error)}`);
    } finally {
      if (!dryRun) saveState(config.sitesDir, ctx.state);
      release();
    }
  }

  const c = ctx.counts;
  log(
    `summary: ${sitesProcessed} site(s) processed, ${withoutClone} without local clone, ${lockedOut} locked; ` +
      `published ${c.published}, rolled back ${c.rolledBack}, unverified ${c.unverified}, failed ${c.failed}, skipped ${c.skipped}`,
  );
  return c.failed + c.unverified > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    log(`fatal: ${errorMessage(error)}`);
    process.exit(2);
  },
);
