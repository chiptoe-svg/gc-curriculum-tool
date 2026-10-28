#!/usr/bin/env tsx
/**
 * Harness spike (2026-10-28): Codex hooks for the interviewer.
 *   harness-codex-hook.ts stop <stateDir>     — Stop: run the controls on the final
 *     answer; on a failure print {"decision":"block","reason":...}, which Codex
 *     turns into a continuation prompt (at most MAX_CONTROL_RETRIES times).
 *   harness-codex-hook.ts pretool <stateDir>  — PreToolUse: deny tool calls once
 *     the per-turn budget is spent (Codex has no budget of its own).
 * stateDir holds state.json (written by the runner), log.jsonl (MCP calls),
 * events.jsonl (what the hooks did) and retries (a counter).
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MATERIAL_TOOLS, MAX_CONTROL_RETRIES, checkCitations, controlFollowUp } from '@/lib/ai/agent/harness/controls';

interface HookState {
  controls: boolean;
  maxToolCalls: number;
  searchRule: { required: boolean; reason?: string };
  history: { messageIds: string[]; chunkIds: string[] };
}

const [, , mode, dir] = process.argv;
const stdin = readFileSync(0, 'utf8');
const input = JSON.parse(stdin || '{}') as { last_assistant_message?: string; tool_name?: string };
const state = JSON.parse(readFileSync(path.join(dir!, 'state.json'), 'utf8')) as HookState;
const logPath = path.join(dir!, 'log.jsonl');
const calls = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { tool: string; chunkIds: string[] }) : [];
const event = (text: string) => appendFileSync(path.join(dir!, 'events.jsonl'), JSON.stringify(text) + '\n');

if (mode === 'pretool') {
  if (calls.length >= state.maxToolCalls) {
    event(`tool budget spent; denied ${input.tool_name}`);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Tool budget for this turn is spent (${state.maxToolCalls} calls). Deliver your answer now.` } }));
  }
  process.exit(0);
}

if (mode === 'stop') {
  if (!state.controls) process.exit(0);
  const retriesPath = path.join(dir!, 'retries');
  const retries = existsSync(retriesPath) ? Number(readFileSync(retriesPath, 'utf8')) : 0;
  const sendBack = (reason: string, label: string) => {
    if (retries >= MAX_CONTROL_RETRIES) { event(`${label}; accepted, no retries left`); process.exit(0); }
    writeFileSync(retriesPath, String(retries + 1));
    event(`${label}; sent back`);
    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
    process.exit(0);
  };
  if (state.searchRule.required && !calls.some(c => MATERIAL_TOOLS.has(c.tool))) {
    sendBack(controlFollowUp('search', state.searchRule.reason!), `search required (${state.searchRule.reason})`);
  }
  let reply: { citations?: unknown[] } | undefined;
  try { reply = JSON.parse(input.last_assistant_message ?? ''); } catch { /* not JSON */ }
  if (!reply) sendBack('Your reply must be the JSON per-turn response (finding, question, citations, readiness).', 'reply was not JSON');
  const retrieved = new Set(calls.flatMap(c => c.chunkIds));
  const problems = checkCitations(reply as never, { retrievedThisTurn: retrieved, history: { messageIds: new Set(state.history.messageIds), chunkIds: new Set(state.history.chunkIds) } });
  if (problems.length) sendBack(controlFollowUp('citations', problems), `citation check failed: ${problems.join(' / ').slice(0, 300)}`);
  process.exit(0);
}

console.error(`unknown mode ${mode}`);
process.exit(1);
