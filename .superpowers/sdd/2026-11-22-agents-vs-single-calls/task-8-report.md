# Task 8 report (code part + smoke)

Files: scripts/bench/agent-wiki.ts, tests/scripts/bench/agent-wiki.test.ts, lib/ai/agent/pi/task.ts (fix), tests/lib/ai/agent/pi/task.test.ts.

Pages (14): the 2026-11-19 review (STATE.md "Wiki rebuilt on Terra medium"): competencies/professional-readiness, targets x5 (account-management, ai-workflow, brand-strategy, creative-generalist, production-operations), courses gc-4800, 3710, 3800, 1050, 1010, 2070, 3730 = 13 (its 14th, the targets index, is not a supported section) + competencies/problem-solving (the refresh-all extra). Total 14, not 15.

Bug found in the loop (lib/ai/agent/pi/task.ts): agent arm on competencies/problem-solving (qwen3.8:off) made 2115 requests, all toolUse, never submitted (45 min). Cause (hypothesis fitted to the code, red-proved by test): a submit that fails its schema never counts toward maxToolCalls, so submit was never forced. Fix: force submit once requests > maxToolCalls + 2. Test red with fix reverted, green with it. After the fix the same call finished in 19 s. Live interview path untouched.

Smoke (free, qwen3.8-27b-fp8:off, competencies/problem-solving, run 1): 3 rows, actual model shown, 0 credits, judge/ sealed (pairs.json + pairs-second.json; cells keys == ['markdown'] only).
single 0 factual/0 unverifiable/0 lint, 20.6 s; agent 0/0/0, 19.2 s; checker 0/0/0, 17.5 s (draft errors 0). Baseline page 0/0/0.
Observation: on competencies/professional-readiness the single arm (qwen:off) failed twice: writer omitted the page ("RECONCILE FAILURE"), 7 s. Counts as an error for that arm.
Wiki repo status --short: empty before and after.

Harness features: scratch-DB guard first; campus scrub; checkpoint after every key; resume; --call-timeout-min (default 20; a timeout is not recorded, stops the run, resume retries); failed keys are recorded and skipped on resume (delete from calls.json to retry); lint = lintWiki on a temp copy of the wiki with the page swapped in, errors on that page only; baseline = current wiki page; one blind pair per page x arm x model (first successful run).
