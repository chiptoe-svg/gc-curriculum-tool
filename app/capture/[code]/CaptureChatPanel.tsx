'use client';

import { useEffect, useRef, useState } from 'react';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import type { CaptureReadiness } from '@/lib/ai/capture/schema';
import type { ChatMessage } from '@/lib/ai/analyze/capture-chat';
import { CitationDrawer, type CitationTarget } from './CitationDrawer';

// Re-export so existing imports from this module keep working.
export type { ChatMessage } from '@/lib/ai/analyze/capture-chat';

async function readNdjson(
  res: Response,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  if (!res.body) throw new Error('no body to stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        // ignore malformed lines — server only emits valid JSON per line
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try { onEvent(JSON.parse(tail)); } catch { /* ignore */ }
  }
}

function ReadinessStrip({
  readiness,
  peakScore,
  coveredEver,
}: {
  readiness: CaptureReadiness;
  /** Highest score the agent has reported across this session. */
  peakScore: number;
  /** Union of covered topics across every turn in this session. */
  coveredEver: string[];
}) {
  const tone =
    readiness.score >= 75 ? 'bg-green-500'
      : readiness.score >= 50 ? 'bg-amber-500'
      : 'bg-slate-400';
  // A meaningful regression — the agent dropped its estimate by ≥15 points
  // from a previous high. Almost always means the catalog changed (faculty
  // edited objectives / skills) and the agent is honestly re-probing the
  // new scope. Surface the prior peak so faculty don't read this as state
  // loss or a bug.
  const regressed = peakScore - readiness.score >= 15;
  return (
    <div className="border-t bg-muted/20 px-4 py-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          Auditor readiness
        </span>
        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${tone}`}
            style={{ width: `${readiness.score}%` }}
          />
        </div>
        <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
          {readiness.score}%
          {regressed && (
            <span
              className="ml-1 text-amber-700"
              title={`Earlier in this session the agent reported ${peakScore}%. The drop usually means the catalog (objectives, skills) changed and the agent is re-probing — not a state-loss bug. Coverage from earlier turns is preserved in the cumulative list below.`}
            >
              (↓ from {peakScore}% — re-probing)
            </span>
          )}
        </span>
        {readiness.good_enough_to_generate && (
          <span
            className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800"
            title="The auditor reports it has enough evidence to generate a defensible profile."
          >
            ready
          </span>
        )}
      </div>
      {coveredEver.length > 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Covered (this session):</span>{' '}
          {coveredEver.join(' · ')}
        </p>
      )}
      {readiness.remaining.length > 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Still probing:</span>{' '}
          {readiness.remaining.join(' · ')}
        </p>
      )}
    </div>
  );
}

interface Props {
  courseCode: string;
  slug: string;
  messages: ChatMessage[];
  onMessagesChange: (next: ChatMessage[]) => void;
  onGenerate: () => void;
  /** When restoring a saved conversation, the last readiness captured. */
  initialReadiness?: CaptureReadiness | null;
  /** Called after each successful turn so the parent can persist progress. */
  onConversationChange?: (messages: ChatMessage[], readiness: CaptureReadiness | null) => void;
}

// The chat panel renders the full transcript, the input row with text +
// voice + send, a "Start session" button when no messages yet, and a
// "Generate Course Outcome Profile" button below the chat that activates after at least
// one assistant reply has been received.
export function CaptureChatPanel({
  courseCode,
  slug,
  messages,
  onMessagesChange,
  onGenerate,
  initialReadiness,
  onConversationChange,
}: Props) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<CaptureReadiness | null>(initialReadiness ?? null);
  // Session-cumulative counterparts to readiness. peakScore tracks the
  // highest score the agent reported; coveredEver is the union of all
  // covered-topic lists. Reset when the conversation resets.
  const [peakScore, setPeakScore] = useState<number>(initialReadiness?.score ?? 0);
  const [coveredEver, setCoveredEver] = useState<string[]>(initialReadiness?.covered ?? []);
  // Set on the first v2 turn that responds with a sessionId; threaded back on
  // every subsequent request so the audit-agent loop can stitch the
  // conversation together server-side. v1 responses leave this null.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [drawerTarget, setDrawerTarget] = useState<CitationTarget | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function postChat(next: ChatMessage[]) {
    setBusy(true);
    setError(null);

    // Optimistically push an empty assistant message so deltas have a place
    // to land. We replace it on each delta and reconcile at 'final'.
    let streamed = '';
    let toolBanner = '';
    const optimistic: ChatMessage = { role: 'assistant', content: '' };
    onMessagesChange([...next, optimistic]);

    try {
      const res = await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/chat?slug=${encodeURIComponent(slug)}&stream=1`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify({
            messages: next,
            ...(sessionId ? { sessionId } : {}),
          }),
        },
      );
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        setError((json as { error?: string }).error ?? `Chat failed (${res.status})`);
        // Drop the optimistic empty assistant turn.
        onMessagesChange(next);
        return;
      }

      type FinalResponse = {
        finding?: string;
        question?: string;
        citations?: ChatMessage['citations'];
        readiness?: CaptureReadiness;
      };
      let finalResponse: FinalResponse | null = null;

      await readNdjson(res, (ev) => {
        const e = ev as { kind: string } & Record<string, unknown>;
        if (e.kind === 'session' && typeof e.sessionId === 'string') {
          setSessionId(e.sessionId);
        } else if (e.kind === 'tool-start' && typeof e.toolName === 'string') {
          toolBanner = `Searching materials via ${e.toolName}…`;
          onMessagesChange([
            ...next,
            { role: 'assistant', content: toolBanner },
          ]);
        } else if (e.kind === 'text-delta' && typeof e.delta === 'string') {
          // Accumulate but don't render — structured-output streaming
          // emits raw JSON tokens as they're built, and showing that
          // mid-stream looks like garbage to the user. Wait for the
          // `final` event to swap in the validated text.
          streamed += e.delta;
          onMessagesChange([
            ...next,
            { role: 'assistant', content: toolBanner || 'Thinking…' },
          ]);
        } else if (e.kind === 'final' && e.response && typeof e.response === 'object') {
          finalResponse = e.response as FinalResponse;
        } else if (e.kind === 'error' && typeof e.message === 'string') {
          setError(e.message);
        }
      });

      if (!finalResponse) {
        if (!streamed) onMessagesChange(next);
        return;
      }

      const fr: FinalResponse = finalResponse;
      // Some agent turns include the question text inside the `finding`
      // paragraph (the prompt asks for 3 paragraphs of prose AND splits
      // into structured finding + question fields — agents satisfy both
      // by writing the question into both). Append `question` only when
      // it's not already part of `finding`, so faculty don't see it twice.
      const finding = (fr.finding ?? '').trim();
      const question = (fr.question ?? '').trim();
      const content = !question
        ? finding
        : finding.includes(question)
          ? finding
          : finding + '\n\n' + question;
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content,
        ...(Array.isArray(fr.citations) && fr.citations.length > 0
          ? { citations: fr.citations }
          : {}),
      };
      const newMessages = [...next, assistantMessage];
      onMessagesChange(newMessages);
      if (fr.readiness) {
        setReadiness(fr.readiness);
        // Track session-cumulative progress so a per-turn score drop
        // (typical after faculty edits the catalog mid-audit) doesn't
        // erase the coverage history the user can already see.
        setPeakScore(prev => Math.max(prev, fr.readiness!.score));
        setCoveredEver(prev => Array.from(new Set([...prev, ...fr.readiness!.covered])));
      }
      onConversationChange?.(newMessages, fr.readiness ?? readiness ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chat failed');
      onMessagesChange(next);
    } finally {
      setBusy(false);
    }
  }

  // Empty messages array signals an "opening turn" to the chat route;
  // the v2 audit agent self-introduces from at-rest context (no fake
  // user message is written to the transcript). v1 path also handles
  // empty messages by self-introducing.
  async function handleStart() {
    await postChat([]);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    onMessagesChange(next);
    setInput('');
    await postChat(next);
  }

  function appendTranscript(text: string) {
    if (!text) return;
    setInput(prev => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
  }

  const canGenerate = messages.some(m => m.role === 'assistant');

  return (
    <section className="rounded-md border bg-card shadow-sm">
      <div className="border-b px-4 py-2">
        <h2 className="text-sm font-semibold">Audit conversation</h2>
        <p className="text-xs text-muted-foreground">
          The auditor reads everything already in the system and asks clarifying questions about
          prereqs, stated vs. evidenced outcomes, and any contradictions across sources.
        </p>
      </div>

      <div
        ref={transcriptRef}
        className="max-h-[55vh] min-h-[280px] overflow-y-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-12 text-center">
            <p className="text-sm font-medium">Start the audit when you&apos;re ready.</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              The auditor opens with what it found in the materials and its first question.
              The conversation runs as long as it needs to ground every rating in evidence —
              you can steer it any time.
            </p>
            <button
              type="button"
              onClick={handleStart}
              disabled={busy}
              className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Start session'}
            </button>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user'
                  ? 'rounded-lg bg-primary/10 px-3 py-2 ml-12'
                  : 'rounded-lg bg-muted/40 px-3 py-2 mr-12'
              }
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {m.role === 'user' ? 'You' : 'Auditor'}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-snug">{m.content}</p>
              {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.citations.map((c, ci) => (
                    <button
                      key={ci}
                      type="button"
                      onClick={() => setDrawerTarget({
                        type: c.type,
                        chunkId: c.chunkId ?? null,
                        messageId: c.messageId ?? null,
                        excerpt: c.excerpt,
                      })}
                      title={c.excerpt}
                      className="inline-flex max-w-full items-center gap-1.5 rounded border bg-background px-1.5 py-0.5 text-[10.5px] font-mono leading-none text-muted-foreground hover:bg-muted"
                    >
                      <span className={'font-semibold ' + (c.type === 'chunk' ? 'text-teal-700' : 'text-amber-700')}>
                        {c.type === 'chunk' ? 'CH' : 'IN'}
                      </span>
                      <span className="max-w-[280px] truncate">{c.excerpt}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
        {busy && messages.length > 0 && messages[messages.length - 1]?.content === '' && (
          <p className="text-xs italic text-muted-foreground">Auditor is thinking…</p>
        )}
      </div>

      {readiness && (
        <ReadinessStrip
          readiness={readiness}
          peakScore={peakScore}
          coveredEver={coveredEver}
        />
      )}

      {messages.length > 0 && (
        <div className="border-t px-4 py-3 space-y-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              // Enter sends; Shift+Enter inserts a newline (standard chat
              // convention). IME composition events are skipped so plain
              // Enter doesn't fire mid-character on languages that need it.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={3}
            placeholder="Type a reply, or use voice. Enter to send, Shift+Enter for a new line."
            className="w-full resize-y rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex items-center justify-between gap-3">
            <VoiceRecorder slug={slug} onTranscript={appendTranscript} disabled={busy} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onGenerate}
                disabled={!canGenerate || busy}
                className={
                  'rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed '
                  + (readiness?.good_enough_to_generate
                    ? 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100'
                    : (readiness?.score ?? 0) >= 50
                    ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                    : 'border-input bg-background hover:bg-muted')
                }
                title={
                  !canGenerate
                    ? 'Send at least one reply first'
                    : readiness?.good_enough_to_generate
                    ? `Auditor reports ${readiness.score}% readiness — ready to generate.`
                    : readiness
                    ? `Auditor reports ${readiness.score}% readiness — you can still generate, but more questions would tighten the profile.`
                    : 'Generate Course Outcome Profile from the current conversation'
                }
              >
                Generate Course Outcome Profile
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || busy}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
      <CitationDrawer
        courseCode={courseCode}
        slug={slug}
        target={drawerTarget}
        onClose={() => setDrawerTarget(null)}
      />
    </section>
  );
}
