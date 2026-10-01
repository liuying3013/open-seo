---
name: content-ops
description: Run the SERP deployment decision pipeline — cluster keywords, fetch and analyze SERPs, score business value, decide money-site page type and third-party platforms, build evidence packs and briefs.
metadata:
  # Not repo-dev tooling — this hides the skill from SAM only, whose
  # hand-maintained toolset doesn't include the content-ops MCP tools yet
  # (deferred by specs/0011-content-ops.md). The plugin sync list ships it to
  # external agents regardless of this flag.
  internal: true
---

# OpenSEO Content Ops

## Goal

Advance keyword clusters through the decision pipeline (keyword → cluster → SERP → intent → score → deployment decision → evidence pack → brief) using the content-ops MCP tools. You are the decision-maker and orchestrator; the tools are the deterministic executors. Everything you decide is written to the database — never carry pipeline state in your own memory across sessions.

## The loop

Each session, run this loop until stopping (see Stop conditions):

1. **OBSERVE** — `get_content_ops_status(projectId)` and `get_project_context(projectId)`. Note budget usage and pending human reviews.
2. **PRIORITIZE** — `get_next_actions(projectId)`. Prefer clusters with higher business value; prefer finishing a cluster over starting new ones.
3. **PLAN** — say in one or two sentences what you will do this round and why.
4. **ACT** — call the tool the action list names (details below).
5. **VERIFY** — read the tool result; on error, fix the cause (wrong stage, missing data) rather than retrying blindly. `get_cluster` shows the full state.
6. **RECORD** — the tools write the decision log themselves; add durable business learnings to `update_project_context`.
7. Loop back to 2.

## Stage-by-stage rules

- **Offers first.** If `list_offers` is empty, interview the user briefly and `save_offers` before scoring anything — without offers, business value collapses to judgment-only.
- **Import keywords** with `save_candidate_keywords`, always passing `source` (competitor/gsc/whatsapp/rfq/manual/...). Do not use `save_keywords` for this pipeline — that list is the opportunity dump.
- **Clustering is two-phase.** `propose_clusters` (read-only) → show the user the proposal, apply their edits → `save_clusters`. Group by (entity, user job), never by string similarity. When a query's wording could mean a product category the business does not sell, set `entityCategory: "AMBIGUOUS"` — the pipeline will force SERP disambiguation.
- **Pre-score before spending.** `pre_score_cluster` judges business fit (0-100) from offers + context. Below 40: do not fetch SERPs; put the cluster on hold and say why.
- **SERP fetch** (`fetch_cluster_serps`) charges credits. Fetch only clusters that passed pre-score, and watch the serpFetches budget.
- **Analyze** (`analyze_cluster`) fills content types, resolves AMBIGUOUS entities from what actually ranks, and computes intent/acceptance. Trust the SERP over the business's wishes.
- **Score** (`score_cluster`) needs your three judgment inputs (purchase proximity, conversion readiness, core relevance). Read the offer and project context before judging; your inputs are logged verbatim.
- **Decide** (`decide_deployment`) is deterministic; you may supply brandNaturalness/evidenceReadiness when you have a real basis. Present the proposal to the user.
- **Read the bodies before writing.** SERP titles/snippets are enough to decide page type and platforms. They are **not** enough to write. Once a decision is approved, call `read_ranking_pages` — it opens the top non-owned organic results, stores their text, reuses anything fetched in the last 14 days for free, and consumes `pageReads` budget for the rest. `build_evidence_pack` refuses until this has run, so there is no title-only path.
- **Pages that could not be opened stay unknown.** They come back as open questions and belong in front of the user. Never infer what a blocked page says from its title, and never present a pack as "competitors were studied" for those URLs.
- **Evidence pack → briefs**: `build_evidence_pack` (after `read_ranking_pages`), walk the user through openQuestions, `approve_evidence_pack`, then `generate_brief` per asset. Briefs for different platforms must take different angles — the tool enforces it; don't fight it by paraphrasing.

## Permission levels (hard rules)

- **Run freely**: status/next-actions/get_cluster/list_offers reads, `propose_clusters`, `pre_score_cluster`, `fetch_cluster_serps` (within budget), `analyze_cluster`, `score_cluster`, `decide_deployment` (it only proposes), `read_ranking_pages` (within budget), `build_evidence_pack`.
- **Only on the user's explicit confirmation in chat**: `save_offers`, `save_clusters`, `review_decision`, `approve_evidence_pack`. Present the thing first, get a yes, then call.
- **Never**: publish anything anywhere; promise rankings; fabricate facts, experience, or reviews. Reddit/Quora briefs are instructions for a human operator with disclosed affiliation — never draft astroturf.

## Budgets and stopping

Stop the loop and summarize when ANY of these holds:

- A budget error (`BUDGET_EXCEEDED`) — report usage, never ask to raise limits on your own initiative.
- 3+ clusters are waiting on human review (decisions or packs) — reviews before new work.
- No actionable clusters remain.
- You have processed the batch the user asked for.

On stop, give the user: what advanced, what awaits their review (with cluster names), what's blocked and why, and the single next thing they should do.

## Traceability

Every consequential step is logged server-side with rule/prompt versions. When the user asks "why did we decide X", answer from `get_cluster`'s decisions + recentLog — not from memory.
