# Pi 1.4.0 to 1.6.1 upgrade check (2026-11-25)

Verdict: PASS. Behavior is unchanged within noise on the campus models, and one Terra case through the real Pi path works.

## Method
- Bench: `scripts/capture/interview-bench.ts --loop pi` (the app's Pi loop; the default `vercel` loop does not touch Pi, so it would test nothing). Scratch DB `gc_curriculum_p2_scratch`, all 29 cases.
- Campus: `--endpoint campus --configs qwen3.8-27b-fp8:off` (free; the setting the Pi tuning rounds used; moving aliases such as cub are not used). Run once at 1546949a (Pi 1.4.0), once at 03df0133 (Pi 1.6.1).
- Probe: `AI_PROVIDER=openai --configs gpt-6.1-terra:medium --cases 2070-088 --max-credits 0.1`, Pi 1.6.1.

## Results (29 cases, Qwen3.8 off, Pi loop)
| | Pi 1.4.0 | Pi 1.6.1 |
|---|---|---|
| Cases run / errors | 29 / 0 | 29 / 0 |
| Files cases searched | 7/7 | 7/7 |
| Files cases cited a file | 7/7 | 7/7 |
| Instructor cases searched | 19/22 | 20/22 |
| Cases with any search (all 29) | 26 | 27 |
| Cases citing a file chunk | 27 | 27 |
| Bad citations | 0 | 0 |
| Cases with no question written | 0 | 0 |
| Model requests (total) | 55 | 63 |
| Tokens in (cached) | 1,863,626 (66%) | 2,199,687 (73%) |
| Tokens out | 16,457 | 18,205 |
| s/turn | 6.2 | 6.5 |

The brief's `submit_turn` schema-valid count is not reported separately by the script; "Errors 0" and a question on every case are the evidence that every reply validated. The differences (+1 search, +8 requests, +14% tokens in) are inside campus-model run-to-run noise.

Two 1.6 cases (3400-005, pksc2200-075) made one or two extra requests not explained by control events; probably model noise. Pi tool errors are now logged to controlEvents (fix M1), so future runs will show them.

## System role and `tools: []` (the specific 1.6 change)
Pi 1.6 sends the `system` role to non-OpenAI OpenAI-compatible providers and omits `tools: []` when tools are off. The campus endpoint is such a provider. No request was rejected: 0 errors, no 400s, no schema errors, forced first-request search worked on the same cases as before, and no "forced search rejected, retrying" line appeared.

## Terra probe (case 2070-088, Pi 1.6.1)
Schema-valid reply with a question, 1 search forced on the first request, 1 file citation, 0 bad citations, 2 requests, 91,695 tokens in (45% cached), 467 out, 12.3 s. The probe ran with effort medium (bench config). An offline payload capture by the final reviewer showed `reasoning: {effort: "medium", summary: "auto"}` on the wire, identical in 1.4 and 1.6. Cost about $0.05 (0.067 credits by the script's estimate), under the $0.10 cap.
Raw outputs: `.superpowers/sdd/2026-11-25-pi-upgrade-1-6/bench-1.4.json`, `bench-1.6.json`, `probe-terra.json`.
