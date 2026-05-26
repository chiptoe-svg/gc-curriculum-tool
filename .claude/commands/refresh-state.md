---
description: Reconcile docs/STATE.md against the current repo and recent commits
---

You are reconciling `docs/STATE.md` with reality. The file is the project's volatile current-state snapshot; the rest of `CLAUDE.md` and `docs/` is stable. Your job is to bring STATE.md back in sync without scrubbing real signal.

## Steps

1. **Read the current `docs/STATE.md`.** Note the `Last verified: <hash> · <date>` line at the top.

2. **Read `CLAUDE.md`** to confirm what STATE.md is supposed to track (the "What this file tracks" list — routes, schema, AI functions, env vars, deployment surface, plan/spec status, what's live).

3. **`git log <last-verified-hash>..HEAD --oneline`** to see what's changed since the last reconciliation. For each commit, decide whether it changes anything STATE.md tracks. Most commits won't.

4. **For each tracked domain, re-derive truth from the repo** (do not trust STATE.md's claims — verify):

   - **Routes:** Survey `app/**/page.tsx` and `app/api/**/route.ts`. Use `codegraph_files path="app"` for the tree. Compare against STATE.md's "What's live" table.
   - **Schema:** `ls drizzle/` for the latest migration number. Read `lib/db/schema.ts` for the current table inventory.
   - **AI functions:** Read `lib/ai/function-settings.ts` for `AI_FUNCTION_IDS` and `DEFAULT_TIERS`.
   - **Env vars:** Read `.env.example`.
   - **Deployment surface:** Read `middleware.ts` and `lib/auth/basic-auth.ts` for the gate behavior; check launchd plist paths.
   - **Plans / specs:** `ls docs/superpowers/plans/ docs/superpowers/specs/`. For each, read the status header (✅ Done / In progress / Blocked / Superseded).
   - **Active arc:** Look at the most recent merges + the most recent plan file to infer what the user is on.

5. **Rewrite STATE.md** to match reality. Preserve the structure (headings, ordering, table shapes). Don't editorialize past what the previous version said unless reality has changed.

6. **Update the `Last verified` line** to `git rev-parse --short HEAD` and today's date.

7. **Show a diff before writing.** If the rewrite is large (>30% of the file changed), pause and explain what changed and why before committing. If small (just the timestamp + a row or two), proceed.

8. **Do not commit yet** — leave that to the user, or ask if they want the rewrite committed.

## Guardrails

- **Don't invent.** If you can't confirm a claim from the repo, drop it or mark it explicitly as "(unverified, last asserted <date>)".
- **Don't strip historical context.** Status callouts like "deferred" or "blocked on X" are load-bearing; preserve them unless you can confirm they're resolved.
- **CodeGraph first** for any structural lookup. `codegraph_context` for a domain area (e.g., "schema and migrations"), `codegraph_files` for a directory tree, `codegraph_search` for a symbol by name. Grep is for literal text only.
- **Run `codegraph sync` first** so the index reflects recent commits (the watcher lags ~500ms behind writes; if commits just landed, sync explicitly).
- **The trigger list in STATE.md's "What this file tracks" section is canonical** — if a commit doesn't touch anything on that list, it shouldn't produce a STATE.md change other than the timestamp.

## Output

When done, write a short summary for the user:

- New `Last verified` hash + date
- Bullet list of what changed in STATE.md (e.g., "added route /program/scaffolding to 'What's live'; bumped latest migration to 0023; updated active-arc to Phase 1B in progress")
- Anything you weren't able to verify and flagged in the doc
