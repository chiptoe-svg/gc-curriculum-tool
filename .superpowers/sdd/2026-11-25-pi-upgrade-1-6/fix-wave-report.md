# Fix wave report (feat/pi-1-6)

## I1 null coercion (fixed)
- Change: `nullsToEmpty(args, schema)` in `lib/ai/agent/pi/controls.ts` (generic: null -> "" for properties typed exactly `string`, null -> [] for exactly `array`; recurses objects and array items; leaves `["string","null"]` fields such as chunkId/messageId alone). Wired as `prepareArguments` on `submit_turn` (turn.ts) and `submit` (task.ts, same exposure via submitSchema).
- Test: `lib/ai/agent/__tests__/pi-turn-null-args.test.ts`. Runs real runPiTurn through the real pi-agent-core loop with a fake model stream (so the real validateToolArguments path), plus a direct validateToolArguments check (excerpt, chunkId/messageId).
- RED (prepareArguments disabled): `expected 'null' to be ''` for finding; direct test asserts without the fix `finding === 'null'` and `covered === ['null']` (passes, documenting 1.6.1 behavior).
- GREEN: 4 passed.

## M1 tool errors in controlEvents (fixed)
- Change: turn.ts subscription now always attached; on `tool_execution_end` with `isError` pushes `tool error: <toolName>: <first 120 chars>` (exported helper `toolErrorEvent`). onEvent forwarding unchanged. Not added to task.ts (not requested; it has no controlEvents).
- Test: unknown tool `no_such_tool` then valid submit; asserts event `tool error: no_such_tool: ...not found`.
- RED (logging disabled): `expected false to be true`. GREEN: passes.

## M2 doc (fixed)
`docs/superpowers/pilot/2026-11-25-pi-1-6-upgrade-check.md`: effort sentence reworded; extra-requests line added under the results.

## M3 build
`pnpm build`: PASS (Next.js production build completed, route table printed). No Pi-related errors.

## Tests
- `pnpm vitest run lib/ai/agent lib/ai/__tests__/interview-loop.test.ts`: 14 files, 123 passed.
- `pnpm test`: 656 files passed, 1 failed (tests/db/p0a-guards.test.ts, expected pre-existing); 5199 tests passed. `tsc --noEmit` clean.
- Behavior otherwise unchanged: no prompt/tool/temperature (0.2)/cap (16000) changes.
