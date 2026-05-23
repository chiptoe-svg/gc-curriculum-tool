'use client';

import { useEffect, useRef, useState } from 'react';
import { VoiceRecorder } from '@/components/VoiceRecorder';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  courseCode: string;
  slug: string;
  messages: ChatMessage[];
  onMessagesChange: (next: ChatMessage[]) => void;
  onGenerate: () => void;
}

// The chat panel renders the full transcript, the input row with text +
// voice + send, a "Start session" button when no messages yet, and a
// "Generate ratings" button below the chat that activates after at least
// one assistant reply has been received.
export function CaptureChatPanel({
  courseCode,
  slug,
  messages,
  onMessagesChange,
  onGenerate,
}: Props) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          body: JSON.stringify({ messages: next }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setError((json as { error?: string }).error ?? `Chat failed (${res.status})`);
        return;
      }
      const { reply } = json as { reply: string };
      onMessagesChange([...next, { role: 'assistant', content: reply }]);
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
            <p className="text-sm font-medium">Start the audit when you're ready.</p>
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
            </div>
          ))
        )}
        {busy && messages.length > 0 && (
          <p className="text-xs italic text-muted-foreground">Auditor is thinking…</p>
        )}
      </div>

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
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                title={canGenerate ? 'Generate ratings from the current conversation' : 'Send at least one reply first'}
              >
                Generate ratings
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
