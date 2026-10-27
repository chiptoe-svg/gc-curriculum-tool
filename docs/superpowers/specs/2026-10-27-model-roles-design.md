# Model roles: Judge, Converse, Write, Extract

**Date:** 2026-10-27. **Status:** approved by the owner 2026-10-27 ("Proceed").
**Builds on:** the model registry `lib/ai/models.ts` (commit `5e05b069`), the 2026-10-05 model evaluation (`docs/superpowers/audits/2026-10-05-model-evaluation.md`).

## Why

The app's 29 AI functions are grouped into three tiers named by size: light, default and heavy. Since 2026-10-06 default and heavy both run gpt-6.1-sol at low effort, so the names no longer say anything. Seven functions also name gpt-6.1-sol directly ("custom" rows in `ai_function_settings`), so a tier change would not reach them.

The owner wants groups that say what kind of work a function does, so that deciding a model for a group is a clear question ("which model is best at this kind of task?"), and so a trial such as GPT-6.1 Terra can be pointed at one group with one change.

## The four roles

| Role | What the task is | What decides the model | How a new model is tested for it |
|---|---|---|---|
| **Judge** | Produces a score or claim that becomes the stored record, with no human check before it counts | Accuracy against the evidence | Blind evidence check, as in the 2026-10-05 evaluation |
| **Converse** | Faculty-facing chat, turn by turn, often with tools | Reliable tool use and speed: a person is waiting | Try on real conversations; watch tool errors and latency |
| **Write** | Prose or proposals a person reads or approves | Writing quality; a human catches errors | Read-through of sample output |
| **Extract** | Bounded extraction, classification or summary into a fixed form, often in bulk | Cost per call | Spot check of accuracy and cost |

### Function assignments (compiled-in defaults)

- **Judge (7):** `program-score-coverage`, `capture-scores`, `capture-stress-test`, `intended-skills-extract`, `prereq-edge-seed`, `bundle-map-onet`, `extract-course-kud`.
- **Converse (6):** `capture-chat-agent`, `capture-chat`, `curriculum-chat`, `explore-agent`, `position-interview-agent`, `kud-chat`.
- **Write (8):** `wiki-update`, `objective-evidence-guide`, `bundle-card-draft`, `position-synthesis`, `synthesize-target`, `reconcile-feedback`, `explore-local-delta`, `position-rated-items`.
- **Extract (8):** `material-digest`, `chunk-contextualize`, `material-classify`, `materials-analysis`, `ingestion-checkin`, `jd-extract`, `parse-profile-fields`, `decompose-prereq-gap`.

Close calls, decided in conversation: `extract-course-kud` is Judge (its output is stored); `parse-profile-fields` is Extract (faculty see the result at once). **`parse-profile-fields` is the one deliberate model change:** it is on the default tier today (gpt-6.1-sol) and moves with Extract to gpt-5.4-mini (owner, 2026-10-27).

## Goals

1. Replace the three tiers with the four roles everywhere a tier is named: the registry, function settings, the settings API and the `/settings` page.
2. Each role carries **a model and a reasoning effort**, set in `lib/ai/models.ts`. Today effort follows the model, which is why heavy and default cannot differ.
3. Moving a role to a new model is one edit in `lib/ai/models.ts`; moving one function is one settings row, as today.
4. `/settings` groups functions by role and shows each role's purpose, model and effort.

## Non-goals

- No model or effort changes, except `parse-profile-fields` (above). Day one, every role maps to what its functions run now:
  - Judge, Converse, Write: gpt-6.1-sol, low effort.
  - Extract: gpt-5.4-mini, no effort setting (as today).
- No Terra trial (a separate, paid decision).
- No per-function effort setting. A function that needs a different effort gets a custom model row as today, or a change of role.
- No change to the campus, local or Anthropic providers (`CAMPUS_LLM_DEFAULT_MODEL` keeps winning on campus).

## Anti-goals (failure even if it works)

- **Any function silently changes model or effort on deploy.** The resolved (model, effort) of all 29 functions must be identical before and after, on the live settings, apart from `parse-profile-fields` moving to gpt-5.4-mini. A test pins the compiled defaults; the live check is part of the rollout.
- A saved settings row stops working or is lost because it holds an old tier name.

## Decided

- **Storage:** `ai_function_settings.tier` is a text column, so no schema migration. New values: `judge`, `converse`, `write`, `extract`, `custom`.
- **Old values keep working, and keep their model.** On read, `light` maps to `extract`. `default` and `heavy` map to the function's compiled-in role, unless that role is Extract: then the row keeps resolving to gpt-6.1-sol at low effort (what `default`/`heavy` meant), exactly like a custom row. So the code can deploy before any data changes, and no saved row changes model. *(Builder's call, from review: a saved `default`/`heavy` row on an Extract function would otherwise drop from Sol to gpt-5.4-mini.)*
- **The seven custom rows that name gpt-6.1-sol** are deleted after deploy by a one-time script (dry run by default, `--apply` to write, owner yes before applying). Each falls back to its compiled-in role, which resolves to the same model and effort. The script deletes only custom rows whose model and effort equal their role's; it lists anything else and leaves it.
- **Effort resolution order:** a caller's explicit effort (evaluation scripts), then `OPENAI_REASONING_EFFORT`, then the role's effort, then the model's default from `DEFAULT_REASONING_EFFORT`. A custom-model row uses the model's default.
- **Naming in the UI:** role names as above, each with its one-line purpose from the table.
- **Roles are read-only in the UI.** `/settings` shows each role's model and effort; a role's model or effort changes only by editing `lib/ai/models.ts`. Per function, the control is a choice of role or a custom model, as today. *(Builder's call.)*
- **Effort reaches every call path.** Resolution returns the model and the effort together. `getProviderForFunction` passes both to the provider; `kud-chat` uses both; the snapshot route records the model only; reliability scripts keep passing an explicit model and effort. *(Builder's call.)*
- **The settings listing reports effort.** `listAllFunctionSettings` (and so `/settings`) returns each function's resolved effort beside its model, which is what the live check compares. *(Builder's call.)*

## Left to the builder

- Internal type and function names (e.g. `ModelRole`, `ROLE_TO_MODEL`, how `resolveModelForFunction` returns effort).
- Layout of the grouped `/settings` page within the existing style.
- Whether `/api/health` reports roles in place of `aiTiers`.
- Test structure, following the repo's TDD practice (red-proof each new test).
- Updating STATE.md: replace the tier column of the AI-function table with roles.

## Rollout

1. Build and test on `dev`; full suite, typecheck, lint.
2. Deploy (old rows still resolve through the mapping).
3. Live check: every function's resolved model and effort on `/settings` equals the list captured before deploy. The pre-deploy list is today's `/settings` (model per function; effort is low for every gpt-6.1-sol function and none for gpt-5.4-mini), captured by the implementer before deploying; no new script.
4. Owner yes, then run the cleanup script with `--apply`; repeat the live check.
