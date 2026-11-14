import { NextResponse } from 'next/server';
import { guardWhatIf } from '@/lib/what-if/route-guard';
import { addWhatIfUsage, appendWhatIfMessage, listWhatIfMessages } from '@/lib/db/what-if-queries';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { attachmentsForAi } from '@/lib/what-if/attachments';
import { streamWhatIfAgent } from '@/lib/what-if/agent';
import type { QuickEstimate } from '@/lib/what-if/agent-tools';
import type { WhatIfAgentResponse } from '@/lib/what-if/agent-response-schema';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import type { CompletionTelemetry } from '@/lib/ai/provider';
import { AiCreditsExhaustedError, CREDITS_EXHAUSTED_MESSAGE, creditsContact } from '@/lib/ai/credit-status';

export const maxDuration = 120;

interface Ctx { params: Promise<{ code: string; id: string }> }

const usageOf = (t: CompletionTelemetry) => ({
  costUsdCents: t.costUsdCents,
  promptTokens: t.cachedTokens + t.uncachedPromptTokens,
  completionTokens: t.completionTokens,
});

/**
 * POST /api/explore/[code]/what-ifs/[id]/chat   body { message: string }
 * Streams the what-if assistant's NDJSON events. The conversation lives in
 * the what-if's own messages (never the interview's); the model's history is
 * read from there, not from the request. Only the author or an admin may talk.
 * A base version that is withdrawn or deleted does not stop the conversation;
 * only creating the page needs it.
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { code: rawCode, id } = await params;
  const g = await guardWhatIf(req, decodeURIComponent(rawCode), id, 'manage');
  if (g.response) return g.response;
  const { whatIf } = g;

  const cap = await checkDailyCap();
  if (!cap.ok) return NextResponse.json({ error: 'daily cost cap reached — service paused for today' }, { status: 503 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 });

  const history = (await listWhatIfMessages(id)).map(m => ({ role: m.role, content: m.content }));
  const approved = whatIf.baseSnapshotId ? ((await getSnapshotById(whatIf.baseSnapshotId))?.profile ?? null) : null;
  const attachments = await attachmentsForAi(id);

  const quickEstimates: QuickEstimate[] = [];
  let chatTelemetry: CompletionTelemetry | null = null;
  let final: WhatIfAgentResponse | null = null;

  const encoder = new TextEncoder();
  let closed = false; // the reader went away; the turn still runs to the end so it is stored and paid for
  const stream = new ReadableStream<Uint8Array>({
    cancel() { closed = true; },
    async start(controller) {
      const send = (ev: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n')); } catch { closed = true; }
      };
      try {
        const gen = streamWhatIfAgent({
          whatIf, approved, history, message, attachments,
          onEstimate: async (q, telemetry) => {
            quickEstimates.push(q);
            await recordSpend(telemetry.costUsdCents);
            await addWhatIfUsage(id, 'quick_estimate', usageOf(telemetry));
          },
          onChatTelemetry: t => { chatTelemetry = t; },
        });
        for await (const ev of gen) {
          if (ev.kind === 'final') final = ev.response;
          send(ev);
        }
        if (final) {
          // Stored together, after the turn finished: user row first, then the reply.
          await appendWhatIfMessage(id, 'user', message);
          await appendWhatIfMessage(id, 'assistant', final.response, { citations: final.citations, quickEstimates });
        }
        if (chatTelemetry) {
          await recordSpend((chatTelemetry as CompletionTelemetry).costUsdCents);
          await addWhatIfUsage(id, 'chat', usageOf(chatTelemetry));
        }
      } catch (err) {
        send(err instanceof AiCreditsExhaustedError
          ? { kind: 'error', code: 'ai_credits_exhausted', message: CREDITS_EXHAUSTED_MESSAGE(creditsContact()) }
          : { kind: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (!closed) { try { controller.close(); } catch { /* already closed */ } }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
