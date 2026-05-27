'use client';

import { useEffect, useRef, useState } from 'react';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import type { CaptureReadiness } from '@/lib/ai/capture/schema';
import type { ChatMessage } from '@/lib/ai/analyze/capture-chat';

// Re-export so existing imports from this module keep working.
export type { ChatMessage } from '@/lib/ai/analyze/capture-chat';

function ReadinessStrip({ readiness }: { readiness: CaptureReadiness }) {
  const tone =
    readiness.score >= 75 ? 'bg-green-500'
      : readiness.score >= 50 ? 'bg-amber-500'
      : 'bg-slate-400';
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
      {readiness.covered.length > 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Covered:</span>{' '}
          {readiness.covered.join(' · ')}
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
  // Set on the first v2 turn that responds with a sessionId; threaded back on
  // every subsequent request so the audit-agent loop can stitch the
  // conversation together server-side. v1 responses leave this null.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function postChat(next: ChatMessage[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/chat?slug=${encodeURIComponent(slug)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            messages: next,
            // Only sent when we already have a v2 session in flight. v1 path
            // ignores this; v2 path uses it to look up tool-call history.
            ...(sessionId ? { sessionId } : {}),
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setError((json as { error?: string }).error ?? `Chat failed (${res.status})`);
        return;
      }
      const {
        reply,
        readiness: nextReadiness,
        sessionId: nextSessionId,
        citations: nextCitations,
      } = json as {
        reply: string;
        readiness?: CaptureReadiness;
        sessionId?: string;
        citations?: ChatMessage['citations'];
      };
      if (typeof nextSessionId === 'string' && nextSessionId.length > 0) {
        setSessionId(nextSessionId);
      }
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: typeof reply === 'string' ? reply : '',
        ...(Array.isArray(nextCitations) && nextCitations.length > 0
          ? { citations: nextCitations }
          : {}),
      };
      const newMessages = [...next, assistantMessage];
      onMessagesChange(newMessages);
      if (nextReadiness) setReadiness(nextReadiness);
      // Autosave after every successful turn so a closed tab / failed
      // Generate / next-day return doesn't lose the conversation.
      onConversationChange?.(newMessages, nextReadiness ?? readiness ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chat failed');
    } finally {
      setBusy(false);
    }
  }

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
              The auditor opens with what it found in the materials and its first questions.
              The conversation runs as long as it needs to ground every rating in evidence.
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
                  {m.citations.map((c, ci) => {
                    const idTail = c.chunkId
                      ? ` (chunk ${c.chunkId.slice(0, 8)}…)`
                      : c.messageId
                      ? ` (msg ${c.messageId.slice(0, 8)}…)`
                      : '';
                    return (
                      <span
                        key={ci}
                        title={`${c.excerpt}${idTail}`}
                        className="inline-flex max-w-full items-center gap-1.5 rounded border bg-background px-1.5 py-0.5 text-[10.5px] font-mono leading-none text-muted-foreground cursor-help"
                      >
                        <span
                          className={
                            'font-semibold '
                            + (c.type === 'chunk' ? 'text-teal-700' : 'text-amber-700')
                          }
                        >
                          {c.type === 'chunk' ? 'CH' : 'IN'}
                        </span>
                        <span className="max-w-[280px] truncate">{c.excerpt}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
        {busy && messages.length > 0 && (
          <p className="text-xs italic text-muted-foreground">Auditor is thinking…</p>
        )}
      </div>

      {readiness && <ReadinessStrip readiness={readiness} />}

      {messages.length > 0 && (
        <div className="border-t px-4 py-3 space-y-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={3}
            placeholder="Type a reply, or use voice. Cmd/Ctrl+Enter to send."
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
    </section>
  );
}
