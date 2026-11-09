# The Interview on Pi — rulings from the Nov 9 ablation

Adds to `2026-11-08-pi-interview.md` (plans are append-only). Evidence: STATE.md, "Why Pi scored worse, and the fix (2026-11-09)"; spike `7706fcb5`; bench folders `tune/` and `interview-blind4/`.

## What the test showed

Free, campus Qwen3.8 thinking off, 9 cases × 3 passes per variant, blind Opus read, failed turns counted as unacceptable:

| Variant | Acceptable | Mean score |
|---|---|---|
| Pi matched (temperature 0.2, search forced first) | 25/27 | 3.52 |
| Stored Sol | 7/9 | 3.33 |
| Pi, temperature 0.2, with send-backs | 18/27 | 2.89 |
| Current loop | 20/27 | 2.85 (4 failed turns) |
| Pi, no send-backs | 10/27 | 2.33 |
| Pi as built | 9/27 | 2.30 |

Pi itself was not the cause; two choices in our setup were.

## Rulings (change the plan's Global Constraints and Task 2)

1. **Temperature 0.2 on every Pi model call**, as the current campus loop uses. A test checks the request body carries it.
   - Cost if wrong: one setting.
2. **Force the search first; don't send the model back afterwards.** When `needsMaterialSearch` fires, the first request forces `search_materials` (`tool_choice` named function). The search send-back is removed, and the retry limit for search becomes 0. The citation check and its two send-backs stay; in the matched runs the repair meant they never fired.
   - Replaces the test `a failed search check sends the model back once, then saves` with `a search-trigger turn forces search_materials on the first request`.
3. **Loosen the excerpt limit in the `submit_turn` tool schema** (no maxLength on `citations[].excerpt`) so `repairCitations` can trim before `AuditResponseSchema` validates.
   - Why: Pi validates tool arguments before `execute`. A quote over 200 characters was rejected nine times in a row until the turn hit the request cap (`t02-pi` r2, case 1010-020).
   - New test: `a citation quote over 200 characters is trimmed, not rejected`.
4. **The current loop gets the same repair before validation** (Part 2a). It failed 1010-020 on all three passes for this reason.

## Still open

- **Model choice:** this test covers only Qwen3.8 thinking off. DeepSeek Flash thinking off has never run on Pi; it's a free arm to add before the owner picks the interview model.
- **Wording:** the editor round (Harness²-style) is no longer needed to close the gap. It can still polish wording once the build exists.
