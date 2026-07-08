#!/usr/bin/env tsx
// scripts/_one-off/explore-agent-harness.ts
//
// Acceptance smoke harness for streamExploreAgent.
// Drives the full streaming agent against a real course and prints
// each event type legibly so the controller can judge quality.
//
// Usage:
//   pnpm tsx --env-file=.env.local scripts/_one-off/explore-agent-harness.ts \
//     "GC 3460" "I'm thinking about adding a graded trapping lab — what would that do, and what should I watch out for?"

import { streamExploreAgent } from '@/lib/ai/explore/agent';
import type { Message } from '@/lib/ai/tool-use-types';

(async () => {
  const courseCode = process.argv[2];
  const userMessage = process.argv[3];

  if (!courseCode || !userMessage) {
    console.error('Usage: explore-agent-harness.ts <courseCode> <userMessage>');
    console.error('  e.g.: "GC 3460" "What would adding a graded trapping lab do?"');
    process.exit(1);
  }

  console.log('=== Explore Agent Harness ===');
  console.log(`Course:  ${courseCode}`);
  console.log(`Message: ${userMessage}`);
  console.log('');

  const messages: Message[] = [{ role: 'user', content: userMessage }];

  let textBuffer = '';

  try {
    for await (const ev of streamExploreAgent({ courseCode, messages })) {
      if (ev.kind === 'tool-start') {
        // Compact args: truncate long values
        const compactArgs = JSON.stringify(ev.args, (_k, v) =>
          typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : v
        );
        console.log(`[tool] ${ev.toolName} ${compactArgs}`);

      } else if (ev.kind === 'text-delta') {
        // Accumulate — print in full at end (avoids interleaving with tool lines)
        textBuffer += ev.delta;
        process.stdout.write(ev.delta);

      } else if (ev.kind === 'scenario') {
        console.log('\n[SCENARIO]');
        console.log(JSON.stringify(ev.scenario, null, 2));

      } else if (ev.kind === 'comparison') {
        const diffKeys = Object.keys(ev.diff ?? {});
        console.log('\n[COMPARISON]');
        console.log(`  A: ${ev.a.courseCode ?? '?'} — ${ev.a.changeProse?.slice(0, 80) ?? '(no prose)'}`);
        console.log(`  B: ${ev.b.courseCode ?? '?'} — ${ev.b.changeProse?.slice(0, 80) ?? '(no prose)'}`);
        console.log(`  diff keys: ${diffKeys.join(', ') || '(empty)'}`);
        console.log(JSON.stringify(ev.diff, null, 2));

      } else if (ev.kind === 'final') {
        // Text was streamed above; print the structured envelope
        if (textBuffer.length > 0) {
          // Ensure we're on a new line after the streamed text
          console.log('');
        }
        console.log('\n=== FINAL ===');
        console.log(`toolCallsUsed: ${ev.toolCallsUsed}`);
        console.log(`\nresponse text:\n${ev.response.response}`);
        if (ev.response.citations && ev.response.citations.length > 0) {
          console.log(`\ncitations (${ev.response.citations.length}):`);
          ev.response.citations.forEach((c, i) => {
            const loc = c.path ?? `${c.courseCode ?? ''}/${c.fileName ?? ''}`;
            console.log(`  [${i + 1}] ${loc} — "${c.excerpt?.slice(0, 100)}"`);
          });
        } else {
          console.log('\ncitations: (none)');
        }

      } else if (ev.kind === 'error') {
        console.error(`\n[ERROR] ${ev.message}`);
        process.exitCode = 1;
      }
    }
  } catch (e) {
    console.error('\n[FATAL ERROR]', e instanceof Error ? e.message : String(e));
    if (e instanceof Error && e.stack) console.error(e.stack);
    process.exitCode = 1;
  }

  console.log('\n=== done ===');
})();
