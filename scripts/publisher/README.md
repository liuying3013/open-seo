# Host-side publisher

Publishes approved page work orders from OpenSEO to site repositories, deploys
them through Coolify, verifies the live page, and reports the result back. It
also reports commits on a site's production branch that did not go through an
approval. It runs on the machine that holds the site clones, once per
invocation (for example from cron).

```
pnpm exec tsx scripts/publisher/run.ts [--project <projectId>] [--dry-run]
```

`--dry-run` fetches and prints what it would do. It pushes nothing, deploys
nothing, writes no state and reports nothing to OpenSEO.

It needs Node 20 or later (dependencies rely on the global `File`). Cron jobs
usually get a minimal `PATH` and no proxy variables, so point the cron
environment at the right Node binary and set `HTTPS_PROXY` / `NO_PROXY` there
if the host needs a proxy to reach the git remote.

## Configuration (environment variables)

| Variable                         | Meaning                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `OPENSEO_URL`                    | Base URL of the OpenSEO instance (the MCP endpoint is `<url>/mcp`).                             |
| `OPENSEO_API_KEY_FILE`           | File containing an OpenSEO API key.                                                             |
| `COOLIFY_URL`                    | Base URL of the Coolify instance. Without it nothing can be deployed, so publishing is refused. |
| `COOLIFY_TOKEN_FILE`             | File containing a Coolify API token (required when `COOLIFY_URL` is set).                       |
| `SITES_DIR`                      | Directory holding one git clone per site, named after the repository (`SITES_DIR/<repo name>`). |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Optional. Chromium binary for the screenshots when Playwright's own browser is not installed.   |

The clones need push access to `origin` for the production branch and a git
identity (`user.name` / `user.email`); the publisher commits with it. Task
branches written by the writing agent must exist as local branches in the
clone.

## What a run does

For every site in the OpenSEO site registry that has a clone in `SITES_DIR`
(under a per-repository lock):

1. `git fetch origin`, then compare `origin/<production branch>` with the last
   checked commit. Commits not pushed by the publisher are reported with
   `report_site_changes`. The first run only records a baseline.
2. Read `list_publish_queue`. Entries with an in-flight attempt, a failed
   attempt on the current approval, or an approval this publisher already pushed
   are skipped.
3. Rollback requests first: `git revert` of the recorded publish commit, push,
   deploy, verify, report `rolled_back`.
4. Each due publication:
   - In a publisher-owned worktree (`SITES_DIR/.publisher/<repo>`), rebase a
     temporary copy of the task branch onto `origin/<production branch>`.
     A conflict stops with `merge`.
   - Recompute `git diff --binary origin/<prod>...HEAD | git patch-id --stable`
     and compare it with the approved fingerprint. A difference stops with
     `fingerprint` (the server voids the approval).
   - Create one squash commit on `origin/<prod>` (`Publish: <title> (asset <id>
v<n>)`), check that its patch id still equals the approved one, and push
     it. A rejected non-fast-forward push is retried once after a fetch; a
     second rejection stops with `push`. This single commit is the one a
     rollback reverts.
   - Deploy: with `autoDeploy` off the publisher triggers a Coolify deployment;
     with it on, it finds the deployment for the pushed commit and triggers one
     itself if none appears within three minutes. It waits up to 25 minutes
     for `finished`; `failed` / cancelled / timeout stops with `deploy`.
   - Verify: fetch the target URL (retrying for a few minutes to get past
     caches) and record status code, `X-Robots-Tag` / meta robots noindex,
     canonical, and a text match score; take 1440px and 390px screenshots with
     Playwright. The server decides between `published` and `unverified`.

Failures are only recorded, never retried automatically. Log lines go to stdout,
one per step, with a summary at the end. Exit code 0 means no failures, 1 means
at least one failed or unverified entry, 2 means the run could not start.

## State

`SITES_DIR/.publisher/state.json` keeps, per repository, the last checked commit,
the commits the publisher pushed, and the approvals it pushed for. Delete a
repository's entry to re-baseline it (the next run will not report anything).

## Text match score

`text-match.ts` turns the approved title and Markdown body into blocks (title,
headings, one block per body line, with Markdown syntax removed), splits both
sides into word tokens (one token per CJK character), and returns the share of
the approved blocks' 3-token sequences found in the live page text, 0-100.
Extra text on the page (navigation, footer) does not lower the score.

## Tests

```
pnpm exec vitest run scripts/publisher
```
