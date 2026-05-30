---
description: Implement the fix for a triaged feedback issue per its triage-comment plan, open a PR with Fixes #N (cron + manual)
---

You are implementing the recommended fix for a faculty-feedback issue that has already been triaged. The most-recent triage comment on the issue contains the plan you will execute.

**Argument:** `$ARGUMENTS` — issue number (e.g. `42`).

## Steps

1. **Verify the issue is eligible.**
   - `gh issue view <N> --repo chiptoe-svg/gc-curriculum-tool --json number,labels,title,body,comments,url`
   - Must have `triaged` label AND at least one of (`effort-trivial`, `effort-small`) — OR any effort with `approved` (operator override).
   - Must NOT have any `gate-*` label UNLESS it also has `approved`.
   - Must NOT already have a linked PR: `gh pr list --repo chiptoe-svg/gc-curriculum-tool --search "fixes:#<N>" --state all --json number` — if non-empty, stop.
   - If ineligible at any of these checks, print one line stating why and stop. Do NOT write code.

2. **Read the triage comment.** The most-recent comment from the operator carries the analysis. Pull the "Recommended fix" and "Related code" sections — that is your spec. If the analysis is ambiguous or names files that no longer exist, stop and add a `needs-clarification` comment on the issue (do not invent a fix).

3. **Branch from `main`.** `git switch -c fix-feedback-<N>`. (You are running inside a fresh worktree per the cron wrapper; the worktree is on `main`.)

4. **Implement per the triage plan.**
   - Follow the "Recommended fix" steps. `effort-trivial` should land in 1 file; `effort-small` in 1–3.
   - Write tests when behavior is testable (component logic, helpers, scoring functions). Skip tests for pure CSS / copy tweaks.
   - Run `pnpm tsc --noEmit` and `pnpm test <touched-area>` — must be clean before committing.
   - **Mid-stream escalation:** if you discover the fix is actually `effort-medium` or larger (more files than estimated, or runs into architectural questions), STOP. Do NOT commit. Post a comment on the issue: "Implementation revised this to effort-medium during work — flagging for manual review." Apply `effort-medium`, remove `effort-trivial`/`effort-small` via `gh issue edit <N> --remove-label effort-trivial --remove-label effort-small --add-label effort-medium`. Exit without opening a PR.

5. **Commit.** Conventional-commit style, referencing the issue:

   ```
   <type>(<scope>): <short imperative subject>

   Implements the fix recommended in the triage of #<N>.

   Fixes #<N>
   ```

6. **Push branch + open the PR.** Title prefix `[bot-<effort>]` so the operator can filter their inbox by effort tier.

   ```bash
   git push -u origin fix-feedback-<N>
   gh pr create \
     --repo chiptoe-svg/gc-curriculum-tool \
     --title "[bot-<effort>] <commit subject>" \
     --body "$(cat <<'EOF'
   Auto-implemented from triaged feedback #<N>.

   Triage analysis: <permalink-to-triage-comment>

   @chiptoe-svg — please review and merge if the fix looks right.

   Fixes #<N>
   EOF
   )"
   ```

7. **Print** the PR URL on a single stdout line so the cron log captures it: `opened PR <url> for #<N>`.

## Conventions

- **Never auto-merge.** Always leave the merge decision to the operator.
- **Never push to `main` directly.** PRs only.
- If `pnpm test` fails partway, fix the failure if it's obvious (typo, missing import). If it's substantive, treat as the mid-stream escalation case in step 4 — do not paper over real test failures.
- This skill runs inside a fresh worktree (`.worktrees/implement-<N>/`); the cron wrapper handles worktree removal after you exit.
- The PR's `@chiptoe-svg` mention is the notification handle. Always include it.
