# Blind judge instructions: agents vs single calls

This is the exact instruction set for a blind judge. It covers one pass over the pairs in
`blind-pairs.json`, written by `scripts/bench/agent-judge.ts`.

## What you are given

- `blind-pairs.json`: a list of pairs `{id, course, competency, A, B}`. Each of `A` and `B` is one
  scored cell: a K, U and D depth score with the evidence excerpt that supports it. One side is
  not labeled with its source, and you must not try to work out which is which.
- Read-only access to the course profile and course files for each `course` in the pair list
  (the bench copy of the database, read-only SQL, and the course materials). Do not write to any
  database or file.

## What you must not open

- `blind-key.json` (or any other file that maps pair ids to the labels `baseline`, `single`,
  `agent`, or `checker`). Never open it, grep it, or infer from file names which side is which.
  The key is applied after you finish.

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

Write one JSON array to `<out>/verdicts.json` (where `<out>` is the harness output directory that holds `blind-pairs.json`), one entry per pair you judged:

```json
[
  {"id": "pair-0001", "winner": "A", "reason": "Cell A's excerpt quotes the rubric; B restates the syllabus."},
  {"id": "pair-0002", "winner": "tie", "reason": "Both excerpts show the same practice at the same depth."}
]
```

Rules for the output:

- `id` must match a pair id exactly.
- `winner` must be exactly `A`, `B`, or `tie`.
- `reason` is one sentence.
- Judge every pair in the file. Do not skip one because it is hard.

## Second judge

A second judge runs on a sample of 20% of the pairs, drawn by `secondJudgeIds` in
`scripts/bench/lib/blind.ts` with its own seed. The second judge follows these same instructions
and writes its verdicts to `<out>/verdicts-second.json`. Judge independently: do not look at another judge's verdicts.

## After judging

Run `scripts/bench/tally-blind.ts --pairs <out>/blind-pairs.json --key <out>/blind-key.json --verdicts <out>/verdicts.json --second <out>/verdicts-second.json`. It unblinds the verdicts with the key and applies
the pre-committed decision rule. The judge does not see that output.
