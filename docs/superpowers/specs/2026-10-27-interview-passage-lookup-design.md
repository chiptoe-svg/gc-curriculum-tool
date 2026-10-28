# Interview passage lookup and a "both sources" evidence label — design

**Date:** 2026-10-27 · **Owner approved the direction:** 2026-10-27 ("yes" to both parts) · **Status:** Part A (passage lookup) **on hold** — later the same day, replays showed the cause was reasoning effort: gpt-6.1-sol at medium searched and cited at 3 of 3 test turns where low searched at 0 of 3, so the Converse role moved to medium (with the material list) instead. Part B (the "both sources" label) is still to be built.

## Why

CourseCapture interviews rarely cite course materials. GC 2070 (session 2026-10-06): 69 interviewer turns,
4 material searches, 4 file citations against 88 instructor citations; none of its 18 competencies ended up
labeled as backed by materials. Two causes, one per part of this design:

1. **The interviewer decides when to search, and it almost never does.** Each turn it reads a summary
   (digest) of every course file — about 50k of its ~70–100k input tokens — and the summaries cannot be
   cited. Replay tests on 2026-10-27 (`scripts/capture/replay-interview.ts`, scratch DB, ~1.6 credits) showed
   that rewording the instructions does not change this: at 5 test turns, three versions (current; a "search
   before you cite" rule; a file list instead of summaries) searched only where the original already had
   (turn 106). Given the stronger rule, the interviewer moved to questions about practice ("what do you
   observe…"), which the rule itself exempts. At turn 104 the instructor quoted the rubric verbatim and the
   interviewer still cited only the instructor.
2. **Findings backed by both the instructor and a file are labeled as guesses.** `deriveSourceFlag`
   (`lib/ai/synthesis/source-derivation.ts`) maps mixed instructor + file citations to `'inferred'` — the same
   label as no evidence. The review screen then says "The AI inferred this — no direct source," and the
   evidence ladder (`lib/program/evidence-ladder.ts`) short-circuits `'inferred'` to `'claimed'`, so the
   best-supported findings rank lowest in the wiki and program views. The 2026-05-26 spec gives no reason for
   this mapping.

The replays also showed the file list (`materialsView: 'index'`, already in `audit-agent.ts`) asks questions
of the same quality at 40–60% fewer tokens.

## Goals

- After every instructor answer, the app — not the interviewer — finds the few course-file passages most
  related to it and puts them in front of the interviewer as citable passages.
- Replace the per-turn summaries with the file list, cutting interview cost roughly in half.
- Findings with both kinds of evidence get their own label, shown honestly in review, wiki and program views.

## Non-goals

- Changing synthesis (why synthesis stopped carrying file citations in August is a separate question; this
  design gives it more file citations to carry, and the replay test measures the interview only).
- Removing the interviewer's search tools — they stay for targeted lookups.
- Changing the depth scale, scoring rules or the evidence ladder's bands.

## Anti-goals (would be a failure even if it works)

- Irrelevant passages get cited as support. A wrong citation is worse than none: it launders a guess into
  "found in materials." Hence the relevance check below.
- The interview starts quoting files at the instructor instead of asking about what students do. Passages
  are context for the interviewer's finding, not the question.
- Credit cost rises. Lookup uses the campus embedding endpoint (no credits); passages add ~1–2k tokens/turn,
  far less than the ~50k the list saves.

## Part A — passage lookup

**Where:** `buildAgentCall` in `lib/ai/agent/audit-agent.ts`, on every non-opening turn when
`auditMode === 'full'`.

**Query:** the interviewer's previous question (the `question` field of the last assistant message) plus the
instructor's new answer, as one text. Rationale: the answer alone is often too short ("no", "website,
contact information…") to retrieve on; the question supplies the subject.

**Search:** the existing course-tenant hybrid search (`createVectorStore().hybridSearch(tenantForCourse(code),
{ queryVector: await embedText(query), queryText: query, k: 8 })`), the same call `search_materials` makes.

**Selection:** from the 8 hits, drop chunks the session has already cited (chunk ids from earlier assistant
messages' citations), then keep the top 4. *Builder's call:* whether to also apply a score floor — only after
the relevance check shows where junk starts.

**Placement:** a block appended to the **current** user message only (not the at-rest context and not
earlier turns), so the cached prefix stays stable and old passages don't accumulate. Format per passage:

```
[chunkId=<id>] <fileName> — <sectionTitle>
<text, trimmed to ~800 characters>
```

under a heading such as `Related passages (found automatically; may not be relevant)`. Earlier turns'
passages are not re-sent; a citation made earlier persists through its chunkId + excerpt as today.

**Failure:** any lookup error (embedding endpoint down, tenant missing) → no block, the turn proceeds, one
warning logged. The interview must never fail because of the lookup.

**File list:** non-opening turns switch to `materialsView: 'index'`. The **opening turn keeps the
summaries** — its instructions ("what the digests show overall") need an overview, and it is one call.

**Prompt (`lib/ai/prompts/capture-chat-agent.md`):** a short section on the passages block: they were found
automatically from the last exchange; when a finding rests on what a passage says, cite it as a `chunk`
citation by its chunkId; ignore passages that don't bear on the finding; never quote them at the instructor
in place of a question. Update "When to retrieve" and any digest wording so it reads correctly with the file
list (the summaries are no longer there after the opening turn). *Builder's call:* exact wording.

### Relevance check (gates the reranker) — no credits

Before any paid test, run the lookup alone (no interviewer call) on GC 2070's session at turns 24, 88, 104,
106, 132 plus ~20 other instructor answers, and write the top 4 passages per turn to a file for the owner and
me to read. Judge each passage relevant / not relevant to the exchange.

- Mostly relevant (≥3 of 4 on most turns) → no reranker.
- Otherwise → add a rerank step over the 8 hits before taking the top 4. **Open:** which reranker. Rag Core
  has one and offered a top-10 rerank (17-question test: correct passage first 41% → 59%); a local
  Qwen3-Reranker is the other candidate. Choose by what is reachable without credits.

### Paid test (~0.5 credits, owner approves before running)

Add an arm `lookup` (file list + passages + new prompt section) to `scripts/capture/replay-interview.ts`.
Run it on GC 2070 turns 24, 88, 104, 132 (original: no search, no file citations at any of them).

**Success:** the interviewer cites a file passage at ≥2 of the 4 turns, no cited passage is irrelevant, and
the owner judges the questions no worse than the originals.

## Part B — a "both sources" label

- Add `'both'` to `CaptureProfileSource` (`lib/ai/capture/schema.ts`): instructor + file citations.
- `deriveSourceFlag`: mixed → `'both'`. No citations stays `'inferred'`.
- Add `'both'` to every strict JSON-schema enum that lists sources (`lib/ai/analyze/capture-scores.ts`, three
  places) — OpenAI strict mode rejects unknown enum values.
- Evidence ladder: no change needed — `'both'` is not `'inferred'`, and a chunk citation already yields
  `materials_supported`.
- Review screen (`ProfileReviewPanel.tsx`): label "From your interview and course materials"; quick-review
  word "you said + materials"; not flagged as inferred. Color: *builder's call*, distinct from the
  existing three.
- Check every consumer for exhaustive handling of the source value: `lib/okf/profile-to-okf.ts`,
  `lib/ai/wiki/update.ts`, `lib/ai/wiki/evidence-band-markers.ts`, `lib/wiki/course-views.ts`,
  `VerificationSummary.tsx`.

**Existing snapshots** stored the old `'inferred'` for mixed findings. A one-time script re-derives
competency sources from their stored citations (pure function, no model calls): dry run by default,
`--expect-db`, owner applies to live. Then the wiki refresh picks up the new labels. This also covers the
relabeling of 10-06 → 10-27 snapshots offered earlier.

## Rollout

Build on `dev` with tests (lookup query building, de-duplication, block rendering, failure path; source
derivation; schema enums). Relevance check → reranker decision → paid replay → owner yes → deploy → watch the
next real capture's citation counts. Part B can ship independently and first.

## Settled after the builder check (my calls)

- **Shared code path.** The lookup lives in `buildAgentCall`, which both the live route and the replay script
  call, so the test measures what ships. The passages block is added to the message sent to the model only; it
  is never written to `capture_messages`.
- **Query source.** Parse the last assistant row's JSON and use its `question` field (not the finding); if
  parsing fails or there is no question, search on the instructor's answer alone.
- **Excluded files.** Drop hits whose material is ignored, retired or not `extractionStatus === 'ok'` (the
  same set the interview lists), using the material rows already loaded in `buildAgentCall`. `fileName` and
  `sectionTitle` come from the search hit (`SearchHit` carries both).
- **Which view.** `buildAgentCall` picks the view itself: summaries on the opening turn **and whenever
  `auditMode` is not `'full'`** (no tools there, so a bare list would leave the interviewer blind); the list
  otherwise. `materialsView` stays as an explicit override for the replay script.
- **Strict enums.** Add `'both'` to the shared `SOURCE_ENUM` and to the three inline enum literals in
  `capture-scores.ts`, and update the rule text near its line 418 and in the synthesis prompt that explains the
  mixed rule, plus the doc comment in `evidence-ladder.ts`.
- **Re-derivation of old snapshots.** Re-derive from the citations as stored. Findings whose citations were
  stripped as unresolvable keep whatever remains: none left → `'inferred'` (unchanged); both kinds left →
  `'both'`. That is the correct label for what is actually stored.

## Left to the builder

Passage trim length, the score floor, prompt wording, the label color, and test names.
