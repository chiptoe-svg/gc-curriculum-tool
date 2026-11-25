/**
 * Shapes a staged turn as the classic AuditResponse, so the chat route, saveTurn, the conversation route and
 * snapshots keep working unchanged (plan 2026-11-25, Task 6; Ruling A for the score).
 */
import type { AuditResponse } from '@/lib/ai/agent/audit-response-schema';
import { settledCount, type EngineState } from './engine';
import type { Ledger } from './ledger';
import type { StagedSubmit } from './staged-tools';

export function toAuditResponse(submit: StagedSubmit, state: EngineState, ledger: Ledger): AuditResponse {
  const { settled, total } = settledCount(state, ledger);
  return {
    finding: submit.say,
    question: submit.question,
    citations: submit.citations,
    readiness: {
      // settled / total never decreases (settledCount counts the graded_on placeholders before anchors exist).
      score: total > 0 ? Math.round((100 * settled) / total) : 0,
      covered: state.stageProgress.filter(s => s.status === 'done').map(s => s.title),
      remaining: state.stageProgress.filter(s => s.status !== 'done').map(s => s.title),
      good_enough_to_generate: state.done || state.mustRecap,
    },
  };
}
