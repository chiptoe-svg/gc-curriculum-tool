---
description: Triage a faculty-feedback GitHub issue. Pass `auto-post` as a second arg to label + comment + tag triaged without waiting for approval (cron mode).
---

You are triaging faculty feedback for the GC Curriculum Tool. Feedback is filed by the in-app `<FeedbackWidget />` (mounted in `app/layout.tsx`) via `POST /api/feedback` (`app/api/feedback/route.ts`) → `createFeedbackIssue` (`lib/feedback/github.ts`) → GitHub Issues in `chiptoe-svg/gc-curriculum-tool` with the `gc-feedback` label.

**Arguments:** `$ARGUMENTS` — `<issue-number> [auto-post]`.

- Issue number is required (or `all` / empty for "every untriaged open issue").
- When `auto-post` is the second arg, run in **CRON MODE**: skip the "show user then wait" step; classify, post the analysis as a GitHub comment, apply the `effort-*` and any `gate-*` labels, and add `triaged` without further prompting.
- Without `auto-post`, run in **INTERACTIVE MODE** (the original behavior — show, wait for "post" / "fix it" / questions).

## Steps

1. **Fetch the issue(s).**
   - If `$ARGUMENTS` is a number: `gh issue view <#> --json number,title,body,labels,url,createdAt,author --repo chiptoe-svg/gc-curriculum-tool`.
   - If `$ARGUMENTS` is empty or `all`: `gh issue list --label gc-feedback --state open --json number,title,body,labels,url,createdAt,author --repo chiptoe-svg/gc-curriculum-tool`, then drop anything whose labels include `triaged`. If zero remain, say so and stop.

2. **Parse each issue body.** The widget files in this exact shape:
   ```
   **From:** <name or _(anonymous)_>
   **Route:** `<path>`
   **Course:** <code, optional>
   **Captured:** <ISO timestamp>
   **User agent:** `<ua>`
   ---
   <freeform text>
   ```
   Extract `name`, `route`, `courseCode`, and the freeform body separately.

3. **Ground in the codebase.** Don't speculate — anchor every claim in real files.
   - `codegraph_context` first with a prompt that combines the route + freeform symptom (e.g. "the citation drawer on /capture/[code] isn't opening when I click a chip"). The route gives you the surface, the prose gives you the symptom.
   - If the report names a specific feature ("scaffolding strip", "AI summary toggle", "streaming chat"), `codegraph_search` for the load-bearing symbol.
   - `git log --oneline -10 -- <relevant-path>` on the most-likely files — recent changes are often the cause. Pay particular attention to commits since the issue's `createdAt`.

4. **Draft the analysis.** For each issue, produce exactly this structure:

```markdown
## Triage — #<num>: <one-line title summary>

**From:** <name> · **Route:** `<route>` · **Course:** <code or —> · **Filed:** <date>

### What's reported
<1–3 sentences in plain language. The faculty's own words paraphrased, NOT the engineering interpretation.>

### Likely cause
<Specific. Name files and line numbers. If multiple plausible causes, list them with confidence. If genuinely unclear, write "unclear — clarification needed" and list the specific questions that would disambiguate.>

### Recommended fix
<One paragraph. If trivial, sketch the change. If small/medium, list the steps. If large, say "needs a plan" and outline the plan's surface area. If "won't fix", explain why (e.g. by design, hardware limitation, deferred to Phase N). If clarification-first, restate the questions to ask the reporter.>

### Effort
<Trivial (<30 min, 1 file) | Small (<2 hr, 1-3 files) | Medium (half-day, multi-file) | Large (full day+, needs a plan doc)>

### Related code
- `path/to/file.ts:LINE` — what it does
- `path/to/other.tsx:LINE` — what it does
```

4b. **Classify effort + gates.** From the analysis, derive:

   - **One effort label:**
     - `effort-trivial` — <30 min, 1 file (e.g. copy fix, color tweak, missing hover state)
     - `effort-small` — <2 hr, 1–3 files (e.g. small new helper + test, one bug fix touching a component + its hook)
     - `effort-medium` — half-day, multi-file (e.g. new sub-feature, refactor across a panel)
     - `effort-large` — needs a plan doc, >1 day
   - **Zero or more gate labels** (apply based on the file paths in "Related code"):
     - `gate-prompts-or-schema` — if the fix would touch `lib/db/schema.ts`, anything under `drizzle/`, or anything under `lib/ai/prompts/`.
     - `gate-auth` — if it would touch `middleware.ts`, anything under `lib/auth/`, or anything under `lib/rate-limit/`.
     - `gate-cost` — if it would touch `lib/ai/function-settings.ts`.
     - `gate-anonymous` — if the issue's body shows `**From:** _(anonymous)_`.

   Include the classification as a preamble in your analysis output:

   ```
   _Bot classification:_ `effort-<X>`, gates: `gate-A`, `gate-B` (or "none").
   ```

5a. **INTERACTIVE MODE (default).** Print the analysis(es) with the classification preamble in the chat. **Do not** post to GitHub automatically — wait for explicit approval.

5b. **CRON MODE (`auto-post` arg).** Without asking:
   1. Write the analysis body to a temp file. Use a HEREDOC into `/tmp/triage-<N>-body.md`.
   2. Post the comment: `gh issue comment <N> --repo chiptoe-svg/gc-curriculum-tool --body-file /tmp/triage-<N>-body.md`.
   3. Apply labels in ONE call: `gh issue edit <N> --repo chiptoe-svg/gc-curriculum-tool --add-label triaged --add-label effort-<X> [--add-label gate-Y ...]`.
   4. Print `triaged #<N> as effort-X with gates: G1, G2` (or `gates: none`) on a single stdout line so the cron log captures it.
   5. Stop. Do NOT advance to implementation — that's `/implement-feedback`'s job.

6. **If (INTERACTIVE MODE) the user replies "post" / "post it" / "ship it":**
   - Write each analysis as a comment via `gh issue comment <#> --body-file <path>` (use a temp file for the multi-line body).
   - Apply `triaged` + the chosen `effort-*` + any `gate-*` labels in a single `gh issue edit <#> --add-label ...` call.
   - Confirm with the issue URL(s).

7. **If (INTERACTIVE MODE) the user wants to fix it now ("fix it" / "do it"):**
   - Branch: `git switch -c fix-feedback-<#>`.
   - Implement the recommended fix (TDD where it makes sense).
   - Commit. Open a PR with `Fixes #<num>` in the body so closing the PR closes the issue.

## Conventions

- Always include `path:line` in claims about code so the user can jump to the spot.
- If a report is ambiguous, list the interpretations and ask the user which to pursue rather than guessing.
- In `all` mode, lead with a one-line manifest ("3 open: #42, #45, #47 — going through them now"), then each triage separated by `---`.
- Stop after step 5 unless the user explicitly says "post" or "fix it". Posting is the user's decision, not yours.
- If you discover during triage that the issue is a duplicate of an earlier one, note the duplicate in the "Likely cause" section and recommend `gh issue close <#> --reason "duplicate of #<other>"` in the "Recommended fix."
