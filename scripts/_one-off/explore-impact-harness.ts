#!/usr/bin/env tsx
// scripts/_one-off/explore-impact-harness.ts
//
// Prove-the-center harness for the Explore impact engine.
// Runs runImpact against a real captured course and prints the raw
// Scenario JSON so the controller can make a go/no-go call.
//
// Usage:
//   pnpm tsx --env-file=.env.local scripts/_one-off/explore-impact-harness.ts \
//     "GC 4800" "add a graded project that requires students to independently produce a full-color press-ready PDF package"

import { runImpact } from '@/lib/ai/explore/run-impact';

(async () => {
  const courseCode = process.argv[2];
  const changeProse = process.argv[3];

  if (!courseCode || !changeProse) {
    console.error('Usage: explore-impact-harness.ts <courseCode> <changeProse>');
    console.error('  e.g.: "GC 4800" "add a graded project that requires students to independently produce a full-color press-ready PDF package"');
    process.exit(1);
  }

  console.log(`Running runImpact for course="${courseCode}"...`);
  console.log(`Change: ${changeProse}\n`);

  const scenario = await runImpact(courseCode, changeProse);
  console.log(JSON.stringify(scenario, null, 2));
  process.exit(0);
})().catch(e => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
