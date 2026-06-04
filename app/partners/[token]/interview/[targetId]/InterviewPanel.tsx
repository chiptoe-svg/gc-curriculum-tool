'use client';

import { useState } from 'react';
import { VoiceRecorder } from '@/components/VoiceRecorder';

interface PartnerMessage {
  role: string;
  content: string;
}

interface Props {
  token: string;
  targetId: string;
  targetName: string;
  initialSessionId: string | null;
  initialMessages: PartnerMessage[];
}

export function InterviewPanel({ token, targetId, targetName, initialSessionId, initialMessages }: Props) {
  const [messages, setMessages] = useState<PartnerMessage[]>(initialMessages);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ captureId: string; createdAt: string } | null>(null);

  async function sendTurn(text?: string) {
    setBusy(true);
    setError(null);
    const userText = text ?? input.trim();
    if (userText) {
      setMessages(m => [...m, { role: 'user', content: userText }]);
    }
    try {
      const res = await fetch(`/api/partners/${encodeURIComponent(token)}/interview/${encodeURIComponent(targetId)}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userMessage: userText || undefined,
          sessionId: sessionId ?? undefined,
        }),
      });
      const json = await res.json() as {
        sessionId?: string;
        response?: { finding?: string; question?: string };
        error?: string;
        detail?: string;
      };
      if (!res.ok || !json.response) {
        setError(json.error ? `${json.error}${json.detail ? ' — ' + json.detail : ''}` : `Turn failed (${res.status})`);
        return;
      }
      if (json.sessionId) setSessionId(json.sessionId);
      const assistantText = [json.response.finding, json.response.question].filter(Boolean).join('\n\n');
      setMessages(m => [...m, { role: 'assistant', content: assistantText }]);
      setInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/partners/${encodeURIComponent(token)}/interview/${encodeURIComponent(targetId)}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const json = await res.json() as { captureId?: string; createdAt?: string; error?: string; detail?: string };
      if (!res.ok || !json.captureId || !json.createdAt) {
        setError(json.error ? `${json.error}${json.detail ? ' — ' + json.detail : ''}` : `Synthesis failed (${res.status})`);
        return;
      }
      setGenerated({ captureId: json.captureId, createdAt: json.createdAt });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setGenerating(false);
    }
  }

  function appendTranscript(text: string) {
    setInput(prev => prev.trim() ? `${prev.trim()}\n\n${text}` : text);
  }

  if (generated) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 px-6 py-6 text-sm">
        <p className="font-semibold">Interview captured — thank you.</p>
        <p className="mt-2">Your responses about <strong>{targetName}</strong> are saved. The GC department will review and follow up if needed. You can close this tab.</p>
      </div>
    );
  }

  return (
    <section className="rounded-md border bg-card shadow-sm">
      <div className="space-y-3 px-4 py-4">
        {messages.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm">Ready when you are.</p>
            <p className="mt-1 text-xs text-muted-foreground">The interviewer will open with a question. Plan on 20-45 minutes; you can pause and come back via the same link.</p>
            <button
              type="button"
              onClick={() => sendTurn()}
              disabled={busy}
              className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Start interview'}
            </button>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'rounded-lg bg-primary/10 px-3 py-2 ml-12' : 'rounded-lg bg-muted/40 px-3 py-2 mr-12'}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {m.role === 'user' ? 'You' : 'Interviewer'}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-snug">{m.content}</p>
            </div>
          ))
        )}
      </div>

      {messages.length > 0 && (
        <div className="border-t px-4 py-3 space-y-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type a reply, or use voice. Enter to send, Shift+Enter for a new line."
            rows={3}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!busy && input.trim()) void sendTurn();
              }
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <VoiceRecorder
              endpoint={`/api/partners/transcribe?token=${encodeURIComponent(token)}`}
              onTranscript={appendTranscript}
              disabled={busy}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleEnd}
                disabled={busy || generating}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {generating ? 'Synthesizing…' : 'End interview & generate'}
              </button>
              <button
                type="button"
                onClick={() => sendTurn()}
                disabled={busy || !input.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="mx-4 mb-3 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
