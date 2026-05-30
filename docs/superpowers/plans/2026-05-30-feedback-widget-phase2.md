# Feedback Widget — Phase 2 (Cron Triage + Tiered Auto-PR) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Faculty submit feedback → within ~15 min a triage comment appears on the GitHub issue → for Trivial/Small issues that don't trip any hard-gate, a PR opens with `Fixes #N` and the user gets a tagged notification. For Medium/Large/gated issues, the triage comment is the stopping point until the user replies `/go`.

**Architecture:** One `launchd` agent (`com.gc.feedback-cron.plist`) wakes every 15 min and runs `scripts/feedback/feedback-cron.sh`. The wrapper polls open `gc-feedback` issues from the repo via `gh`, classifies each by labels (`triaged`, `effort-*`, `gate-*`, `approved`), and dispatches one of three actions: **triage** (untriaged → invoke `/triage-feedback <N> auto-post`), **implement** (Trivial/Small with no gate, or any effort with `approved` → invoke `/implement-feedback <N>`), or **skip** (everything else). Both `claude -p` invocations run in throwaway git worktrees under `.worktrees/triage-<N>/` and `.worktrees/implement-<N>/` to keep the main checkout clean. Cost interlock: before each invocation, the wrapper queries the existing `daily_cost` table — if today's spend is at or above `DAILY_COST_CAP_USD`, the run logs "cost-capped" and stops without dispatching. The triage skill, when run with the `auto-post` second-arg, posts the analysis as an issue comment, applies one `effort-*` label, applies any matching `gate-*` labels, and adds `triaged`. The new `/implement-feedback` skill reads the existing triage comment, implements per its "Recommended fix" section, opens a PR with `Fixes #N`, and `@chiptoe-svg`-tags in the PR body.

**Action ladder (per issue, evaluated by the wrapper):**

| State (label combination) | Action | Worktree | Cost ~ |
| --- | --- | --- | --- |
| `gc-feedback` + no `triaged` | run `/triage-feedback <N> auto-post` | yes | $0.05–0.15 |
| `triaged` + (`effort-trivial` ∨ `effort-small`) + no `gate-*` + no linked PR | run `/implement-feedback <N>` | yes | $0.30–2.00 |
| `triaged` + (`effort-medium` ∨ `effort-large`) + `approved` + no linked PR | run `/implement-feedback <N>` | yes | $0.30–4.00 |
| anything else (`gate-*` set, `effort-*` blocked, PR already open) | skip | — | $0 |

**Hard gates (applied by the triage skill when it adds `effort-*`):**
- Touches `lib/db/schema.ts`, `drizzle/`, or anything under `lib/ai/prompts/` → add `gate-prompts-or-schema`.
- Touches `middleware.ts`, `lib/auth/`, or `lib/rate-limit/` → add `gate-auth`.
- Touches `lib/ai/function-settings.ts` → add `gate-cost`.
- Issue body's `From:` field is `_(anonymous)_` → add `gate-anonymous`.
- Daily cost cap saturated → wrapper short-circuits before invocation (no label).

Any `gate-*` label blocks auto-implement regardless of effort. To override, the user removes the gate label and adds `approved`.

**Tech:** `launchd` (StartInterval = 900 s), Bash 5, `gh` CLI, `git worktree`, Claude Code in headless mode (`claude -p "<slash-cmd args>"`), Drizzle/Neon for cost lookup via a small `tsx` helper.

---

## File structure

- **Create:** `scripts/feedback/feedback-cron.sh` — orchestrator
- **Create:** `scripts/feedback/daily-cost-check.ts` — query `daily_cost` for today's total cents
- **Modify:** `.claude/commands/triage-feedback.md` — handle `auto-post` second-arg: post comment + add `effort-*` and `gate-*` labels + `triaged`
- **Create:** `.claude/commands/implement-feedback.md` — implement per the existing triage comment, open PR
- **Create:** `~/Library/LaunchAgents/com.gc.feedback-cron.plist` — every-15-min launchd agent
- **Modify:** `.claude/settings.local.json` — pre-approve the bash patterns the cron uses (so headless Claude doesn't trip permission prompts)
- **Modify:** `docs/STATE.md` — note the cron + label scheme + cost interlock
- **GitHub labels (one-off `gh` invocations, not in the codebase):** `effort-trivial`, `effort-small`, `effort-medium`, `effort-large`, `gate-prompts-or-schema`, `gate-auth`, `gate-cost`, `gate-anonymous`, `approved`

---

## Task 1: GitHub labels

**Where:** GitHub repo `chiptoe-svg/gc-curriculum-tool`. No file changes.

- [ ] **Step 1: Create the labels via `gh`**

```bash
gh label create effort-trivial --color C2E0C6 --description "Bot-classified: trivial fix (<30 min, 1 file)" || true
gh label create effort-small --color FEF2C0 --description "Bot-classified: small fix (<2 hr, 1-3 files)" || true
gh label create effort-medium --color FBCA04 --description "Bot-classified: medium fix (half-day, multi-file)" || true
gh label create effort-large --color D93F0B --description "Bot-classified: large fix (needs a plan doc)" || true
gh label create gate-prompts-or-schema --color B60205 --description "Touches schema or AI prompts — manual approval only" || true
gh label create gate-auth --color B60205 --description "Touches auth/middleware/rate-limit — manual approval only" || true
gh label create gate-cost --color B60205 --description "Touches function-settings/model selection — manual approval only" || true
gh label create gate-anonymous --color B60205 --description "Reporter is anonymous — manual approval only" || true
gh label create approved --color 0E8A16 --description "Operator override: auto-implement allowed despite gate or effort tier" || true
```

- [ ] **Step 2: Verify**

`gh label list` — confirm all 9 new labels exist.

---

## Task 2: daily-cost helper

**File:** Create `scripts/feedback/daily-cost-check.ts`.

- [ ] **Step 1: Write the helper**

```typescript
/**
 * Print today's cumulative AI spend in 1/100-cent units. Cron wrapper compares
 * against DAILY_COST_CAP_USD * 10000 to decide whether to dispatch.
 *
 * Run via: `pnpm exec tsx --env-file=.env.local scripts/feedback/daily-cost-check.ts`
 * Outputs a single integer on stdout (today's spend, in 1/100-cent units).
 */

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

async function main() {
  const result = await db.execute(sql`
    SELECT COALESCE(total_cost_usd_cents, 0) AS spent
    FROM daily_cost
    WHERE day = CURRENT_DATE
    LIMIT 1
  `);
  const row = result.rows[0] as { spent?: number | string } | undefined;
  const spent = row?.spent ? Number(row.spent) : 0;
  process.stdout.write(String(spent));
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Smoke-test**

```bash
pnpm exec tsx --env-file=.env.local scripts/feedback/daily-cost-check.ts
echo  # newline
```

Expected: a non-negative integer.

- [ ] **Step 3: Commit**

```bash
git add scripts/feedback/daily-cost-check.ts
git commit -m "feat(feedback): daily-cost lookup helper for cron interlock"
```

---

## Task 3: Modify `/triage-feedback` for auto-post mode

**File:** Modify `.claude/commands/triage-feedback.md`.

- [ ] **Step 1: Add auto-post behavior**

In the current frontmatter, update `description` to:

```
description: Triage a faculty-feedback GitHub issue. Pass `auto-post` as a second arg to label + comment + tag triaged without waiting for approval (cron mode).
```

In the body, replace the `Argument:` line with:

```markdown
**Arguments:** `$ARGUMENTS` — `<issue-number> [auto-post]`. Issue number is required. When `auto-post` is the second arg, run in CRON MODE (skip the "show user then wait" step; post the analysis as a GitHub comment, apply effort + gate labels, and add the `triaged` label without further prompting). Without `auto-post`, run in INTERACTIVE MODE (the original behavior — show, wait for "post" or "fix it").
```

After step 4 (Draft the analysis), insert a new step before the existing step 5:

```markdown
4b. **Classify effort + gates.** From the analysis, derive:
   - One effort label: `effort-trivial` (<30 min, 1 file) / `effort-small` (<2 hr, 1–3 files) / `effort-medium` (half-day, multi-file) / `effort-large` (needs a plan doc, >1 day).
   - Zero or more gate labels (apply based on the file paths in "Related code"):
     - `gate-prompts-or-schema` if the fix would touch `lib/db/schema.ts`, anything under `drizzle/`, or anything under `lib/ai/prompts/`.
     - `gate-auth` if it would touch `middleware.ts`, anything under `lib/auth/`, or anything under `lib/rate-limit/`.
     - `gate-cost` if it would touch `lib/ai/function-settings.ts`.
     - `gate-anonymous` if the issue's body shows `**From:** _(anonymous)_`.

   Include the chosen labels in your output preamble:

   ```
   _Bot classification:_ `effort-X`, gates: `gate-A`, `gate-B` (or "none").
   ```
```

Then replace step 5 with two variants:

```markdown
5a. **INTERACTIVE MODE (default).** Print the analysis(es) in the chat with the classification preamble. Do NOT post to GitHub. Stop and wait for the user's reply ("post" / "ship it" / "fix it" / questions).

5b. **CRON MODE (`auto-post` arg).** Without asking:
   1. Write the analysis body to a temp file: `cat > /tmp/triage-<N>-body.md <<'EOF' ... EOF`
   2. Post the comment: `gh issue comment <N> --repo chiptoe-svg/gc-curriculum-tool --body-file /tmp/triage-<N>-body.md`
   3. Apply labels: `gh issue edit <N> --repo chiptoe-svg/gc-curriculum-tool --add-label triaged --add-label effort-<X> [--add-label gate-Y ...]`
   4. Print "triaged #<N> as effort-X with gates: G1, G2" to the cron log.

   In `all` cron mode (`$ARGUMENTS` is empty or `all` plus `auto-post`), loop over every untriaged open issue. Skip any whose `gh issue view` shows it already has `triaged` (race-safety).
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/triage-feedback.md
git commit -m "feat(slash): /triage-feedback gains auto-post (cron) mode"
```

---

## Task 4: New `/implement-feedback` skill

**File:** Create `.claude/commands/implement-feedback.md`.

- [ ] **Step 1: Write the command**

```markdown
---
description: Implement the fix for a triaged feedback issue per its triage-comment plan, open a PR with Fixes #N
---

You are implementing the recommended fix for a faculty-feedback issue that has been triaged. The triage comment on the issue contains the plan you'll execute.

**Argument:** `$ARGUMENTS` — issue number (e.g. `42`).

## Steps

1. **Verify the issue is eligible.**
   - `gh issue view <N> --repo chiptoe-svg/gc-curriculum-tool --json number,labels,title,body,comments`
   - Must have `triaged` label AND one of `effort-trivial` / `effort-small` (OR any effort with `approved`).
   - Must NOT have any `gate-*` label UNLESS it also has `approved`.
   - Must NOT already have a linked PR (check `gh pr list --search "fixes:#<N>"`).
   - If ineligible, print why and stop — do not write code.

2. **Read the triage comment.** The most-recent comment from `chiptoe-svg` (or the GitHub Actions bot if we ever switch to one) carries the analysis. Pull the "Recommended fix" and "Related code" sections — those are your spec.

3. **Branch.** `git switch -c fix-feedback-<N>` from `main`.

4. **Implement per the triage plan.**
   - Follow the "Recommended fix" steps. If the triage said "Trivial" the fix should be 1 file; "Small" up to 3.
   - Write tests when behavior is testable (component logic, helpers, scoring functions). Skip tests for pure CSS/copy tweaks.
   - Run `pnpm tsc --noEmit` and `pnpm test <touched-area>` — must be clean before commit.
   - If midway you discover the fix is actually Medium/Large (more files than estimated, or runs into architectural questions), STOP. Comment on the issue: "Implementation revised this to effort-medium during work — flagging for manual review." Add the `effort-medium` label, remove `effort-trivial`/`effort-small`, delete the branch, exit. Do not open a PR.

5. **Commit.** Conventional-commit message referencing the issue:
   ```
   <type>(<scope>): <short description>

   Implements the fix recommended in the triage of #<N>.

   Fixes #<N>
   ```

6. **Open the PR.** Title prefix `[bot-<effort>]` so the user can filter their inbox:
   ```
   gh pr create --title "[bot-trivial] <commit subject>" --body "$(cat <<'EOF'
   Auto-implemented from triaged feedback #<N>.

   Triage comment: <permalink>

   @chiptoe-svg — please review and merge if the fix looks right.

   Fixes #<N>
   EOF
   )"
   ```

7. **Print** the PR URL to stdout (for the cron log).

## Conventions

- Never auto-merge. Always leave the merge decision to the human.
- Never push to `main` directly. PRs only.
- If `pnpm test` fails partway, fix the failure if it's an obvious typo; if it's substantive, treat it like step 4's mid-stream-escalation case (comment on the issue, label as medium, exit).
- Worktree-clean: this skill is invoked inside a fresh worktree (`.worktrees/implement-<N>/`); after the PR is open, the cron wrapper handles the worktree removal.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/implement-feedback.md
git commit -m "feat(slash): /implement-feedback — auto-PR from a triaged issue"
```

---

## Task 5: Cron wrapper

**File:** Create `scripts/feedback/feedback-cron.sh`.

- [ ] **Step 1: Write the wrapper**

```bash
#!/usr/bin/env bash
# Feedback widget Phase 2 — cron wrapper. Runs every 15 min via launchd.
#
# For each open `gc-feedback` issue:
#   - Untriaged → run `/triage-feedback <N> auto-post` in a fresh worktree
#   - Triaged AND eligible (effort-trivial|small without gates, OR any effort with approved)
#     AND no linked PR → run `/implement-feedback <N>` in a fresh worktree
#   - Else skip
#
# Hard cost cap: check daily_cost table before each dispatch. If today's spend
# >= DAILY_COST_CAP_USD * 10000 (1/100-cent units), log and stop the run.
#
# Logs to ~/.local/state/gc-curriculum-tool/feedback-cron.log

set -uo pipefail

REPO_DIR="/Users/admin/projects/curriculum_developer"
LOG_DIR="$HOME/.local/state/gc-curriculum-tool"
LOG_FILE="$LOG_DIR/feedback-cron.log"
REPO="chiptoe-svg/gc-curriculum-tool"

mkdir -p "$LOG_DIR"
exec >> "$LOG_FILE" 2>&1
echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ) feedback-cron start ---"

cd "$REPO_DIR" || { echo "cd $REPO_DIR failed"; exit 1; }

# Load DAILY_COST_CAP_USD from .env.local
DAILY_CAP_USD=$(grep '^DAILY_COST_CAP_USD' .env.local | cut -d= -f2- | awk '{print $1}')
DAILY_CAP_USD=${DAILY_CAP_USD:-10}
DAILY_CAP_CENTS_HUNDREDTHS=$(( DAILY_CAP_USD * 10000 ))

check_budget() {
  local spent
  spent=$(pnpm exec tsx --env-file=.env.local scripts/feedback/daily-cost-check.ts 2>/dev/null)
  spent=${spent:-0}
  if (( spent >= DAILY_CAP_CENTS_HUNDREDTHS )); then
    echo "cost-capped: today's spend ${spent} >= cap ${DAILY_CAP_CENTS_HUNDREDTHS} (1/100¢)"
    return 1
  fi
  return 0
}

dispatch_triage() {
  local issue_num="$1"
  if ! check_budget; then exit 0; fi
  local wt=".worktrees/triage-$issue_num"
  git worktree remove --force "$wt" 2>/dev/null || true
  git worktree add "$wt" main || { echo "worktree add failed for triage-$issue_num"; return 1; }
  echo "→ triage #$issue_num"
  ( cd "$wt" && claude -p "/triage-feedback $issue_num auto-post" --permission-mode acceptEdits ) || \
    echo "claude triage of #$issue_num exited non-zero"
  git worktree remove --force "$wt" 2>/dev/null || true
}

dispatch_implement() {
  local issue_num="$1"
  if ! check_budget; then exit 0; fi
  local wt=".worktrees/implement-$issue_num"
  git worktree remove --force "$wt" 2>/dev/null || true
  git worktree add "$wt" main || { echo "worktree add failed for implement-$issue_num"; return 1; }
  echo "→ implement #$issue_num"
  ( cd "$wt" && claude -p "/implement-feedback $issue_num" --permission-mode acceptEdits ) || \
    echo "claude implement of #$issue_num exited non-zero"
  git worktree remove --force "$wt" 2>/dev/null || true
}

# Eligibility check for implement mode.
should_implement() {
  local labels="$1"   # comma-separated list of label names
  local has_triaged=$(echo "$labels" | grep -c 'triaged' || true)
  local has_trivial=$(echo "$labels" | grep -c 'effort-trivial' || true)
  local has_small=$(echo "$labels" | grep -c 'effort-small' || true)
  local has_medium=$(echo "$labels" | grep -c 'effort-medium' || true)
  local has_large=$(echo "$labels" | grep -c 'effort-large' || true)
  local has_gate=$(echo "$labels" | grep -c 'gate-' || true)
  local has_approved=$(echo "$labels" | grep -c 'approved' || true)

  if (( has_triaged == 0 )); then echo "no"; return; fi
  if (( has_approved == 1 )); then echo "yes"; return; fi
  if (( has_gate == 1 )); then echo "no"; return; fi
  if (( has_trivial + has_small >= 1 )); then echo "yes"; return; fi
  echo "no"
}

# Iterate open gc-feedback issues.
issues_json=$(gh issue list --repo "$REPO" --label gc-feedback --state open \
  --json number,labels --limit 50 2>/dev/null || echo '[]')

count=$(echo "$issues_json" | jq 'length')
echo "open gc-feedback issues: $count"

for i in $(seq 0 $((count - 1))); do
  num=$(echo "$issues_json" | jq -r ".[$i].number")
  labels=$(echo "$issues_json" | jq -r ".[$i].labels | map(.name) | join(\",\")")
  has_triaged=$(echo "$labels" | grep -c 'triaged' || true)

  # Skip if a PR already references this issue.
  pr_count=$(gh pr list --repo "$REPO" --search "fixes:#$num" --state all --json number 2>/dev/null | jq 'length')
  if (( pr_count > 0 )); then
    echo "#$num skip: PR exists"
    continue
  fi

  if (( has_triaged == 0 )); then
    dispatch_triage "$num"
  else
    if [[ $(should_implement "$labels") == "yes" ]]; then
      dispatch_implement "$num"
    else
      echo "#$num skip: triaged but ineligible (labels: $labels)"
    fi
  fi
done

echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ) feedback-cron end ---"
```

- [ ] **Step 2: Make executable + smoke**

```bash
chmod +x scripts/feedback/feedback-cron.sh
bash scripts/feedback/feedback-cron.sh
tail -20 ~/.local/state/gc-curriculum-tool/feedback-cron.log
```

Expected on first run with zero open issues: `open gc-feedback issues: 0` and clean exit.

- [ ] **Step 3: Commit**

```bash
git add scripts/feedback/feedback-cron.sh
git commit -m "feat(feedback): cron wrapper — triage + auto-PR orchestrator"
```

---

## Task 6: launchd plist + pre-approved permissions

**Files:** Create `~/Library/LaunchAgents/com.gc.feedback-cron.plist` (NOT in the repo; this is per-machine config). Modify `.claude/settings.local.json` to pre-approve the bash patterns the cron uses.

- [ ] **Step 1: Write the plist**

`~/Library/LaunchAgents/com.gc.feedback-cron.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gc.feedback-cron</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/admin/projects/curriculum_developer/scripts/feedback/feedback-cron.sh</string>
    </array>

    <key>WorkingDirectory</key>
    <string>/Users/admin/projects/curriculum_developer</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>/Users/admin</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>

    <!-- Every 15 minutes -->
    <key>StartInterval</key>
    <integer>900</integer>

    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/Users/admin/.local/state/gc-curriculum-tool/feedback-cron.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/admin/.local/state/gc-curriculum-tool/feedback-cron.stderr.log</string>
</dict>
</plist>
```

- [ ] **Step 2: Pre-approve bash patterns in `.claude/settings.local.json`**

Read the current file (do not stomp existing perms — merge):

```bash
cat .claude/settings.local.json
```

Edit to add (preserving the existing `allow` array entries) under `permissions.allow`:

```json
"Bash(gh issue *)",
"Bash(gh pr *)",
"Bash(gh label *)",
"Bash(git switch *)",
"Bash(git worktree *)",
"Bash(git branch *)",
"Bash(pnpm tsc *)",
"Bash(pnpm test *)",
"Bash(pnpm exec tsx *)"
```

Final file should still have the playwright + brainstorming + WebSearch entries plus these additions.

- [ ] **Step 3: Load the launchd job (manual, one-time)**

```bash
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.gc.feedback-cron.plist
launchctl kickstart -k "gui/$(id -u)/com.gc.feedback-cron"
# Wait ~5 seconds then:
tail ~/.local/state/gc-curriculum-tool/feedback-cron.log
```

Expected: a log entry from the immediate `RunAtLoad` firing.

- [ ] **Step 4: Register the port (it has no port, but follow project convention by noting in `~/.dev-ports.yaml`)**

Actually no port — skip this step.

- [ ] **Step 5: Commit (just the settings.local.json change; the plist is per-machine)**

```bash
git add .claude/settings.local.json
git commit -m "chore(claude): pre-approve cron bash patterns (gh / git worktree / pnpm tsc)"
```

---

## Task 7: STATE update

**File:** Modify `docs/STATE.md`.

- [ ] **Step 1: Update the cross-cutting section**

Replace the existing `<FeedbackWidget />` row with:

```markdown
| **Feedback widget Phase 1+2** on every faculty page | Phase 1: floating "💬 Feedback" → modal → `POST /api/feedback` → GitHub Issue (`gc-feedback` label). **Phase 2 (2026-05-30):** launchd cron `com.gc.feedback-cron` (every 15 min) orchestrates `/triage-feedback <N> auto-post` for untriaged issues and `/implement-feedback <N>` for eligible triaged ones (Trivial/Small without gates, or any effort with `approved`). Hard gates: `gate-prompts-or-schema` / `gate-auth` / `gate-cost` / `gate-anonymous` block auto-implement until operator overrides with `approved`. Cost interlock: `daily_cost` lookup before each dispatch, run halts at `DAILY_COST_CAP_USD`. PRs prefixed `[bot-<effort>]` for inbox filtering; never auto-merged. | live | 2026-05-30 |
```

Update the "Env vars" section if needed (no new env vars; cron reads `DAILY_COST_CAP_USD` from `.env.local`).

Add a new bullet under "Deferred / debt" or "What this file tracks" noting that the launchd plist `com.gc.feedback-cron` is per-machine (not in repo) like `com.gc.curriculum-tool.plist`.

Bump `Last verified` to the commit SHA of this STATE update.

- [ ] **Step 2: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): feedback widget Phase 2 — cron triage + tiered auto-PR"
```

---

## Verification (post-execute, manual)

1. **Cron log entry exists** — `tail ~/.local/state/gc-curriculum-tool/feedback-cron.log` shows the RunAtLoad firing with "open gc-feedback issues: 0".
2. **File a real test feedback** — open `/capture/GC 4800?slug=…` in the browser, use the widget to submit a Trivial-sounding bug ("the feedback button doesn't have a hover state"). Wait ~15 min.
3. **Confirm cron triage fires** — log shows `→ triage #N`, then a triage comment appears on the issue with classification preamble + `effort-trivial` + `triaged` labels.
4. **Confirm cron implement fires next pass** — within another 15 min, log shows `→ implement #N`, and a PR appears titled `[bot-trivial] ...` with `Fixes #N`.
5. **Confirm PR sits** — no auto-merge.
6. **File a medium-sounding bug** — confirm triage labels it `effort-medium` and that the next pass shows `#N skip: triaged but ineligible (labels: gc-feedback,triaged,effort-medium)`.
7. **Confirm approval override** — `gh issue edit <N> --add-label approved`; the next pass should dispatch implement.

---

## Self-Review

**Coverage:** labels (T1), cost interlock helper (T2), triage skill auto-post mode + classification (T3), implement skill (T4), cron wrapper with eligibility logic (T5), launchd + permissions (T6), STATE (T7). ✅

**Hard gates implemented:** prompts/schema, auth, cost, anonymous. All four make it into the triage classification step (T3) and the wrapper's eligibility check (T5).

**Cost interlock:** daily_cost table query before each invocation. Wrapper exits gracefully when capped.

**Out of Phase 2 scope:**
- Multi-comment triage discussions (back-and-forth refinements). User can just edit the GitHub issue comments or re-run `/triage-feedback <N>` interactively.
- Auto-merge on green CI. Deliberately omitted — every PR goes through human merge.
- Per-faculty rate limiting. The widget's existing IP rate limit applies.
- Telemetry on triage quality (was the PR merged as-is, with edits, or closed without merging? — useful Phase 3 signal).

**Tradeoffs noted:**
- `--permission-mode acceptEdits` lets the cron's Claude write files without asking, but it does NOT bypass the bash `allow` list. That's why Task 6 Step 2 pre-approves the specific bash patterns.
- Worktrees are removed even on failure. If a triage or implement run crashes mid-way, the worktree is gone but the issue's labels reflect partial state (e.g., a `triaged` label without a comment, or a branch without a PR). The cron's next pass will re-attempt because the eligibility check is label-driven, not state-driven. Idempotency: triage skipping when `triaged` is already set (race-safety in the skill body); implement skipping when a PR already exists.
- Using `gh pr list --search "fixes:#<N>"` to detect "PR already exists" depends on GitHub's search picking up the `Fixes #N` keyword in the PR body. If it misses for any reason, the cron might open a duplicate. The risk is bounded by the human review on the PR; worst case is closing one of two PRs.

---

## Execution Handoff

Plan complete. Saved to `docs/superpowers/plans/2026-05-30-feedback-widget-phase2.md`.

Recommended execution: subagent-driven-development (tasks have varying complexity; the cron wrapper deserves a careful review pass).
