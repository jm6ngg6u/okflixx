
# OKFLIX Launch Readiness Deep Audit — Execution Plan

Scope: Deliver the full Phase 1–6 audit exactly as specified in the uploaded brief. No item skipped. Evidence-based (file:line, SQL, RPC invocation, Playwright). Order strictly Phase 1 → 6.

## Phase 1 — Discovery (systems 1–37)
For each of the 37 systems (Public 1–9, Admin 10–24, Server fns 25–32, DB 33–37) perform:
- 1a static read (imports, side effects, module-scope `process.env`, timers, AbortControllers)
- 1b data-flow trace of every await/RPC/realtime
- 1c state matrix (loading/empty/partial/error/offline/rate-limited/unauth/maintenance/job-*/gate-*/reduced-motion/hidden-tab)
- 1d secret hygiene grep across `src/lib/*.functions.ts`
- 1e schema snapshot per table (columns, policies, grants, indexes)
- 1f RPC hygiene (SECURITY DEFINER, `search_path=public`, EXECUTE grants)
- 1g cron audit (`cron.job` + `cron.job_run_details`)

Batched in parallel where independent: reads of files, SQL introspection queries, `supabase--linter`, grep sweeps.

## Phase 2 — Defect Log
Enumerate every finding as F### with severity P0/P1/P2 across categories:
A. Correctness · B. Concurrency/Races · C. Error handling · D. Security (RLS/GRANT/service-role/captcha residue/AAL2/OAuth redirect/rate-limit gate rule) · E. Performance @ 2000 users + required indexes · F. Data integrity (uniqueness, FKs, stuck-lock reaper, override drift) · G. UX/a11y (dropdown opacity, reduced motion, focus trap, tap targets) · H. Observability (job_runs, admin_activity_log, structured logs, quiet hours) · I. Cloudflare Workers runtime · J. Regression matrix toggles.

No fixes yet. Each finding cites file:line / table.column / rpc name.

## Phase 3 — Fix Plan
Every F### gets: severity, location, root cause, minimal-diff strategy, exact verification command, rollback. Ordered P0-security → P0-crash → P1 → P2 with dependency ordering (fix RLS before RPC that traverses it).

## Phase 4 — Implement
One finding at a time. Minimal diff. Run the exact verification before advancing. Re-run `supabase--linter` after every migration. Revert before re-patching if a prior fix was wrong.

## Phase 5 — End-to-End Verification Matrix
Execute all 37 scenarios in the brief's table. Record pass/fail with evidence link (screenshot path / SQL result / server-function log line). Playwright drives interactive scenarios; SQL + `stack_modern--invoke-server-function` drives server-side ones.

## Phase 6 — Final Report
1. Executive summary + launch verdict (ship / ship-with-caveats / hold)
2. Full defect log with status
3. Diff summary (files, ±lines, migrations)
4. Verification evidence table
5. Residual risks + monitoring alerts (job failures, worker_error rate >5%, realtime disconnect, stuck locks >10)
6. Production launch checklist (all 17 items ticked)

## Rules of engagement (enforced throughout)
- Read before edit. Never guess.
- No edits to auto-generated files (`src/integrations/supabase/*` except non-generated, `.env`, `supabase/config.toml`, `routeTree.gen.ts`, `_authenticated/route.tsx`).
- Preserve design tokens: uppercase headers, opaque dropdowns, Work Sans + Sora, `.text-shine`/`.text-live`/`.glow-border`/`.why-card`/`.faq-card`, red-gradient hover.
- No emojis in code. No stray `console.log`. Structured logs only.
- Never mark fixed without the exact listed verification. Revert before re-patching.
- Surface conflicts with prior memories (no captcha, no admin maintenance bypass, uppercase kickers) before proceeding.

## Deliverable cadence
Begin at Phase 1 / System 1 (`src/routes/index.tsx`) and proceed sequentially through all 37. Progress reported in-line as each phase completes; no Phase 6 summary until Phases 1–5 are done.

## Estimated size
Large. Expect dozens of file reads, ~30–60 SQL introspection queries, one or more migrations for missing indexes / stuck-lock reaper / cron prefix rename if `emberlord-*` still active, targeted Playwright runs for scenarios 12, 17–23, 27–29, 32, 36.
