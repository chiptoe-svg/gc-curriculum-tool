# System Audit — 2026-06-07

Source: 8-area adversarial multi-agent audit (20 agents, refute-by-default verification of every high/critical). Run `wf_10decd9c-516`. This file is the durable work-list for the audit-remediation program; it survives context compaction. Check items off as they land.

**Tally:** 39 raw → 11 confirmed high/critical, 1 refuted, 27 mediums/lows.

**Deploy reality (load-bearing for severity):** single local Mac, Postgres `127.0.0.1:5433`, bound `0.0.0.0:3000`, internet-exposed via Tailscale Funnel. Faculty surfaces gated by `FACULTY_BASIC_AUTH` (middleware). `/partners`, `/api/partners`, `/`, `/view/*` are internet-public (`PUBLIC_PREFIXES`). Vercel/Neon/Resend retired 2026-06-04. Deployed `AI_PROVIDER` is campus/local (cost 0), so paid-OpenAI cost findings are latent but one env flip from live.

**HOLD for explicit user sign-off (do NOT deploy/relaunch):**
- The slug→Bearer auth-mechanism migration + faculty-auth scaffolding (could lock people out of the live tool). *Note: adding the missing `isValidSlug` gates to 3 routes (F1) is NOT this — it is consistency with the existing 9 gated routes, no lockout risk, safe to ship.*
- The demand→coverage seam schema migration (Phase 4).

---

## Remediation status (updated 2026-06-07, branch `audit-remediation-2026-06-07`)

**All 11 confirmed high/critical FIXED** (each its own commit, tsc + full suite green; suite grew 760→~800 tests):
- F1 admin slug gates · F2 campus Zod→JSON · F3 FERPA enforcement · F4 FERPA patterns · F5 /view redaction · F6 scaffolding brittle · F7 wiki git-race serialization · F8 wiki path allowlist · F9 transcribe cap · F10 coverage cap · F11 (partial) provider fail-closed + kuds model.

**Mediums/lows fixed:** superseder-retired filter, count-positions-retired, stale-preview-prefixes (+ middleware comment), prereq-gap null-vs-zero phantom gap, partner transcribe active-check, **TOCTOU upserts → onConflictDoUpdate (3 fns)**, **whisper-openai-fallback now opt-in (FERPA)**, **partner-supersedes cross-owner validation**, **openai completeWithTools cost metering**, **raw-error-detail-leak on partner chat**, **CLAUDE.md Vercel→local-only drift**.

**Notable correction to the audit's severity math:** `.env.local` sets `AI_PROVIDER=openai` — the deployed provider is **paid OpenAI, not campus**. So the cost findings (F9/F10/F11) were *live*, not latent. F9/F10 cap the two largest paid fan-outs.

**Still deferred (need the user's eyes / a design decision — NOT done):**
- F11 broad rollout: cap+spend across the ~10 unguarded faculty AI routes. Cleanest as centralized accounting inside `provider.complete`, but that double-counts the ~6 routes that already `recordSpend` — needs a coordinated refactor. (The two biggest paid fan-outs, transcribe + coverage, ARE now capped.)
- scaffolding practice+integration-no-intro → `coverage_only` mislabel: needs a new status value / UI+spec alignment.
- legacy `getProvider()` scorers ignore per-function model settings (~13 sites): mechanical migration to `getProviderForFunction` + functionId additions.
- wiki: batch-pages-silently-dropped reconciliation, index-stale-in-first-batch, prompt-injection fencing.
- doc drift: STATE.md dead-prompt list (kud-chat mislabeled, count 33→37) — run `/refresh-state`.
- raw-snapshot-pushed-to-git: add a private-repo startup assertion.
- low/cosmetic: daily-cap UTC-vs-CURRENT_DATE window, spreadsheet base64 strip breadth, getSessionInstructor limit-50, evidence-ladder source='materials'.
- timing-safe Basic-Auth/slug compares (fold into the HELD auth-hardening work).

---

## Confirmed high / critical — fix these (Phase 1)

- [ ] **F1 · admin-routes-missing-slug-gate** (high, security) — `app/api/admin/partners/[partnerId]/mark-invited/route.ts`, `app/api/admin/v2-reset/route.ts`, `app/api/admin/v2-backfill/route.ts`. Three admin POST routes lack the `isValidSlug()` second factor every other admin route has; `v2-reset` is one-request data-loss (deletes the snapshot system-of-record). Fix: add the body-slug gate; factor a shared `requireAdmin(req)` helper; mark-invited currently takes no body and its client caller (`PartnersTable.tsx markInvited`) sends no slug — update the client to POST `{slug}`. Add a test asserting every `app/api/admin/**/route.ts` gates.

- [ ] **F3 · ferpa-detect-result-never-gates-llm** (CRITICAL, FERPA) — `lib/capture/finalize-extraction.ts:82-131`. `detectFerpaRisk` result is stored but never enforces; inclusion is filename-only via `evaluateMaterialsPolicy`. A FERPA-bearing PDF with a non-gradebook name reaches the external digest LLM + embeddings + scoring. Fix: in `runV2Pipeline`, when `ferpa.level === 'high'` (arguably 'medium'), auto-set-aside (`ignored: true`, indexing 'skipped') and return BEFORE `generateMaterialDigest`/`embedBatch`, mirroring the `!policy.included` branch. Only active under `COURSECAPTURE_V2_INGESTION=1`.

- [ ] **F4 · ferpa-detector-narrow-patterns** (high→med, FERPA) — `lib/capture/ferpa-detect.ts:17-37`. Patterns catch only literal `Name | Grade`, Clemson C+8 CUID, exact "Submitted by". Broaden: any table header with name-ish (`/name|student|first|last/i`) AND grade-ish (`/grade|score|points|mark|%/i`) cell; add email regex; multiple person-name rows → ≥ medium. Pairs with F3.

- [ ] **F5 · view-route-public-evidence-leak** (high, FERPA) — `/view/<code>` is public and renders unconstrained model output (`strongest_evidence`, `overview.narrative`, per-competency `evidence_*`). Chained with F3 → student PII on an unauthenticated page. Fix: redaction pass over generated profile fields (reuse/extend ferpa-detect regexes — CUID, "Submitted by" names, emails) at the `/view` render boundary before passing to `CapturedView`.

- [ ] **F6 · scaffolding-cooccur-false-brittle** (high, correctness) — `lib/program/scaffolding.ts:190-199`. A single cell `{K:2,U:1,D:4}` (intro+integration same course) is mislabeled `brittle_scaffold` because brittle uses array index, not `sequenceIndex`. Fix: compute `minIntegrationSeq` = min sequenceIndex among integration cells; brittle iff NO intro/practice cell has `sequenceIndex <= minIntegrationSeq`. Regression test: single `{K:2,U:1,D:4}` → not brittle.

- [ ] **F7 · concurrent-background-regen-corrupts-git-worktree** (high, correctness) — `app/api/program/coverage/refresh/route.ts:135-137` fires N detached `regenerateWikiInBackground` → N concurrent `writeAndPush` on ONE git working tree, no lock. Fix: serialize via a module-level promise chain in `lib/wiki/git-ops.ts` (or one combined commit). Also surface the swallowed errors in `update.ts:802-807`.

- [ ] **F8 · llm-returned-paths-unvalidated** (high, ai-schema) — `lib/ai/wiki/update.ts:761-768`. LLM-returned page `path` written verbatim; only a traversal guard, no allowlist. Fix: intersect returned paths with requested `affectedWikiPages[].path` ∪ caller-owned `raw/` set; drop/hard-error others; constrain `resolvePagePath` (or an LLM-write wrapper) to top-level allowlist `courses/ competencies/ targets/ concepts/ raw/ index.md`; forbid `.git/` and `log.md` from LLM writes.

- [ ] **F9 · transcribe-routes-bypass-daily-cap** (high, cost) — `app/api/transcribe/route.ts`, `app/api/partners/transcribe/route.ts`. Only `checkIpRateLimit`; paid OpenAI Whisper fallback never gated nor `recordSpend`-ed. Partner route on Vercel always took paid path. Fix: `checkDailyCap()` before `transcribeAudio` (503 over); make `transcribeAudio` return `backend`; when `'openai'`, estimate cost (~$0.006/min) and `recordSpend()`.

- [ ] **F10 · coverage-refresh-uncapped-batch** (high, cost) — `app/api/program/coverage/refresh/route.ts`, `.../[snapshotId]/[targetId]/route.ts`, `lib/ai/analyze/program-score-coverage.ts`. Batch paid AI loop, no cap, drops `costUsdCents`. Fix: add `costUsdCents` to `ScoreCoverageResult`/return; `checkDailyCap()` before each pair (break + `stoppedAtCap`); `recordSpend()` after each cell write.

- [ ] **F2 · campus-tool-params-zod-not-jsonschema** (high, ai-schema) — `lib/ai/campus.ts:116-123`. Sends raw Zod schema as OpenAI tool `parameters` (never converted). Latent (campus inactive) but breaks all tool-use on the documented one-line-revert config. Fix: `parameters: z.toJSONSchema(t.inputSchema)` (zod v4.4.3 has it). Test: `oaiTools[0].function.parameters.properties` exists, `.def` does not.

- [ ] **F11 · ai-routes-missing-cap-and-spend** (high→med, cost) — `lib/ai/provider.ts:143` defaults unset `AI_PROVIDER` to paid `openai`; ~10 faculty routes never `checkDailyCap`/`recordSpend`. Fix: (1) fail-closed at provider.ts:143 (throw when unset) — **verify deployed env sets AI_PROVIDER before relying on this**; (2) centralize cap+spend in `getProviderForFunction`/`provider.complete`, or apply `applyAnalyzeGuards()`+`recordSpend()` uniformly; (3) kuds/generate: replace hardcoded `claude-sonnet-4-6` literal.

---

## Refuted

- **partner-rsc-overserialization** — REFUTED. `WelcomeScreen`/`PartnerDashboard` are Server Components (no `'use client'`), so props never enter the Flight payload; no exposure. Optional hygiene: pass only `{firstName, company}`.

---

## Mediums / lows (Phase 1 tail / opportunistic)

- [ ] **M · superseder-not-retired-filtered** (med, data) — `lib/db/position-capture-queries.ts:165-178`. NOT EXISTS superseder sub-query lacks `AND sup.retired_at IS NULL`; a retired superseder permanently hides the original from the aggregate. Latent (no retire writer yet). One-line fix.
- [ ] **M · toctou-select-then-write-upserts** (med, correctness) — `course-profile-queries.ts:54-94`, `capture-conversations-queries.ts:40-64`, `capture-snapshots-queries.ts:151-185 (loadSnapshotAsDraft)`. Select-then-insert on PK tables → 23505 under concurrency. Fix: `onConflictDoUpdate`.
- [ ] **M · scaffolding-practice-integration-no-intro-coverage-only** (med, correctness) — `lib/program/scaffolding.ts:201-211`. practice+integration, no intro → falls through to `coverage_only` (status contradicts phases). Add explicit branch.
- [ ] **M · prereq-gap-null-kud-phantom-gap** (med, correctness) — `lib/program/prereq-gaps.ts:99-100`. `got ?? 0` conflates null (not-applicable/foundational) with 0 → phantom K/U gaps with basis 'measured'. Distinguish null-delivered from 0.
- [ ] **M · legacy-scorers-ignore-function-model-settings** (med) — ~13 scorers use `getProvider()` not `getProviderForFunction()`; settings-UI model tiers silently ineffective for Q1/Q2 scoring.
- [ ] **M · batch-pages-silently-dropped** (med, wiki) — `update.ts:730-768`. Requested-but-omitted pages silently dropped; 'unchanged' on a non-existent page never creates it. Reconcile requested-vs-returned.
- [ ] **M · index-generated-stale-in-first-batch** (med, wiki) — `index.md` generated in batch 1 without visibility into batches 2..N. Generate index in a final pass.
- [ ] **M · prompt-injection-into-wiki-prose-and-paths** (med, security) — fence snapshot-derived content as untrusted data in the wiki-update message; combine with F8 allowlist.
- [ ] **M · transcribe-skips-active-check** (med, security) — `app/api/partners/transcribe/route.ts:21-22` only checks existence, not `partner.active`; revoked partners can still spend. One-line fix (pairs with F9).
- [ ] **M · whisper-openai-fallback-no-ferpa-gate** (med, FERPA) — make OpenAI audio fallback opt-in, not automatic on missing binary; surface external transfer to UI.
- [ ] **M · state-md-dead-prompt-claims-wrong** (med, docs) — STATE.md:167 says kud-chat.md dead (it's mounted); actually-dead are draft-outcomes.md (`kud-draft.ts`) + score-coverage.md (`coverage-score.ts`). Count is 37 not 33.
- [ ] **L · kuds-chat-orphaned-route** — mounted, no UI caller, still burns cap. Delete route+test+chain or rewire.
- [ ] **L · stale-preview-public-prefixes** — `basic-auth.ts:23,25` still lists removed `/preview`,`/api/preview`. Remove + scrub comments.
- [ ] **L · claudemd-vercel-openai-drift** — CLAUDE.md architecture paragraph still describes the retired Vercel/OpenAI dual deploy.
- [ ] **L · count-positions-ignores-retired** — `lib/partners/queries.ts:89-106` counts retired; diverges from retired-aware target aggregate. (pairs with superseder fix)
- [ ] **L · basic-auth-not-timing-safe** / **slug-equality** — non-constant-time compares (folds into the held auth-hardening work).
- [ ] **L · openai-completewithtools-cost-zero** — `openai.ts:240-241` returns cost 0 on non-stream tool path; mirror `streamWithTools` pricing.
- [ ] **L · partner-supersedes-unvalidated-cross-owner** — verify `supersedes` target ownership on create.
- [ ] **L · evidence-ladder-source-materials-ignored** / **chunk-not-depth-validated** — known deferred per-cell evidence gaps (documented).
- [ ] **L · raw-error-detail-leak** — several routes return raw exception text; worst on internet-facing partner routes.
- [ ] **L · getsessioninstructor-limit-50** — long-session instructor attribution can drop to null.
- [ ] **L · daily-cap-timezone-inconsistency** — UTC key vs `CURRENT_DATE` window; cosmetic near midnight.
- [ ] **L · raw-snapshot-and-transcript-pushed-to-third-party-git** — wiki repo MUST stay private (currently is); nothing in code enforces. Add a private-repo assertion/STATE note.
- [ ] **L · spreadsheet-compact-base64-defense-narrow** — broaden data-URI strip beyond `image/*` and apply to all Docling output, not just xlsx.

---

## What's well-guarded (do not "fix" — verified correct)

Partner IDOR (every positions/[id]/* checks `partnerId` match + session ownership); 192-bit CSPRNG magic tokens, stripped from admin list; session expiry + active re-check; no SQL injection anywhere; ordinal-MAX prereq aggregation is a true MAX (no double-count); no_data-vs-zero handled in PF path; strict-mode JSON schemas compliant across audited files; evidence-above-zero Zod refinements gate DB writes; storage route traversal + stored-XSS defense; execFile (no shell) in git-ops; temp-file cleanup in try/finally everywhere; partner/Vercel paid routes are the best-guarded (cap+spend+ownership).
