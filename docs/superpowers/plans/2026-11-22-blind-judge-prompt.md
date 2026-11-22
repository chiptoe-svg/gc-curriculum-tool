# Blind judge instructions: agents vs single calls

This is the exact instruction set for a blind judge. It covers one pass over the pairs in the
sealed judge folder `<out>/judge/`, written by `scripts/bench/agent-judge.ts`. `<out>` is the
harness output directory for one run.

## What you may read

- `<out>/judge/pairs.json` (first judge) or `<out>/judge/pairs-second.json` (second judge). Each
  pair is `{id, course, competency, A, B}`. `A` and `B` are two scored cells for the same
  competency. Each cell has a K, U and D depth score and the evidence excerpt that supports it.
  Pair ids are opaque and the pairs are in shuffled order.
- Read-only course data: the course profile and course files for each `course` in the pairs,
  through read-only SQL on the bench copy of the database, or read-only material search.

## What you must not open

- Nothing else under `<out>`. Do not open `blind-key.json`, `summary.json`, `summary.md`,
  `calls.json`, `pairs-second.json` (if you are the first judge), or any other file in the output
  directory. The key maps pair ids to the arm that produced each cell, and the summary carries the
  same information. Opening either one breaks the blinding.
- Do not infer which side is which from file names, pair order, id numbers, or excerpt wording.
- Do not write to any database or to any file except your verdicts file.

## The question for each pair

For each pair, answer one question:

> Which cell is the better-supported reading of what students actually do in this course, per the
> depth scale in `lib/ai/prompts/shared/depth-scale.md`?

Judge only what the course evidence supports. Check each cell's excerpt against the course profile
and the course files. Score a depth higher only when a student-side artifact or assessment backs
it. Aspirational syllabus wording does not count. A cell that makes a claim its excerpt does not
support is worse than one that stays within its evidence, even if the first reads more fluently.

Do not score the cells yourself. Do not favor a side because it is longer, more confident, or
better written. Choose one of three answers:

- `A`: cell A is the better-supported reading.
- `B`: cell B is the better-supported reading.
- `tie`: neither reading is better supported.

Give one sentence of reason.

## Output

First judge: write one JSON array to `<out>/judge/verdicts.json`, with one entry per pair you judged.
Second judge: write the same format to `<out>/judge/verdicts-second.json`.

```json
[
  {"id": "p001", "winner": "A", "reason": "Cell A's excerpt quotes the rubric; B restates the syllabus."},
  {"id": "p002", "winner": "tie", "reason": "Both excerpts show the same practice at the same depth."}
]
```

Rules for the output:

- `id` must match a pair id in your pairs file exactly.
- `winner` must be exactly `A`, `B`, or `tie`.
- `reason` is one sentence.
- Judge every pair in your pairs file. Do not skip one because it is hard.

## Second judge

`pairs-second.json` holds a 20% sample of `pairs.json`. The sample is drawn with a seed derived from
the run seed, so it is reproducible. The second judge follows these same instructions, judges only
the pairs in `pairs-second.json`, and writes `<out>/judge/verdicts-second.json`. Judge
independently: do not look at another judge's verdicts.

## After judging

The tally runs outside the judge's session:

    tsx scripts/bench/tally-blind.ts --pairs <out>/judge/pairs.json --key <out>/blind-key.json \
      --verdicts <out>/judge/verdicts.json --second <out>/judge/verdicts-second.json

It unblinds the verdicts with the key and applies the pre-committed decision rule. The judge does
not see that output.

## Method note: a residual tell (accepted)

Each competency's stored baseline cell appears once per candidate arm and model, so the same
baseline cell recurs across scattered pairs. A judge who notices a repeated cell could infer that it
is the baseline. Shuffling and opaque ids do not remove this. We accept it and do not try to hide
it further. Judges should not try to use it.
