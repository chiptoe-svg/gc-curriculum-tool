'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { VoiceRecorder } from '@/components/VoiceRecorder';

interface AgentMessage {
  role: 'assistant' | 'user';
  content: string;
}

interface AuditResponse {
  finding?: string;
  question?: string;
  readiness?: { score: number; covered: string[]; remaining: string[] };
}

interface Props {
  token: string;
  captureId: string;
  positionTitle: string | null;
}

export function Page6Section({ token, captureId, positionTitle }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [readinessScore, setReadinessScore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-start: fire the opening anchor turn on mount
  useEffect(() => {
    void fireOpeningTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function fireOpeningTurn() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/partners/${encodeURIComponent(token)}/positions/${encodeURIComponent(captureId)}/chat`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      const json = await res.json() as {
        sessionId?: string;
        response?: AuditResponse;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !json.response) {
        setError(json.error ? `${json.error}${json.detail ? ' — ' + json.detail : ''}` : `Failed to start interview (${res.status})`);
        return;
      }
      if (json.sessionId) setSessionId(json.sessionId);
      if (json.response.readiness?.score !== undefined) setReadinessScore(json.response.readiness.score);
      const assistantText = buildAssistantText(json.response);
      setMessages([{ role: 'assistant', content: assistantText }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error starting interview');
    } finally {
      setBusy(false);
    }
  }

  async function sendTurn() {
    const userText = input.trim();
    if (!userText || busy || !sessionId) return;
    setInput('');
    setBusy(true);
    setError(null);
    setMessages(m => [...m, { role: 'user', content: userText }]);
    try {
      const res = await fetch(
        `/api/partners/${encodeURIComponent(token)}/positions/${encodeURIComponent(captureId)}/chat`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userMessage: userText, sessionId }),
        },
      );
      const json = await res.json() as {
        sessionId?: string;
        response?: AuditResponse;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !json.response) {
        setError(json.error ? `${json.error}${json.detail ? ' — ' + json.detail : ''}` : `Turn failed (${res.status})`);
        return;
      }
      if (json.sessionId) setSessionId(json.sessionId);
      if (json.response.readiness?.score !== undefined) setReadinessScore(json.response.readiness.score);
      const assistantText = buildAssistantText(json.response);
      setMessages(m => [...m, { role: 'assistant', content: assistantText }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd() {
    if (!sessionId) return;
    setGenerating(true);
    setError(null);
    try {
      // Step 1: finalize — synthesize the profile
      const finalizeRes = await fetch(
        `/api/partners/${encodeURIComponent(token)}/positions/${encodeURIComponent(captureId)}/chat`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ finalize: true, sessionId }),
        },
      );
      const finalizeJson = await finalizeRes.json() as {
        profile?: unknown;
        model?: string;
        sessionId?: string;
        error?: string;
        detail?: string;
      };
      if (!finalizeRes.ok || !finalizeJson.profile || typeof finalizeJson.model !== 'string') {
        setError(
          finalizeJson.error
            ? `${finalizeJson.error}${finalizeJson.detail ? ' — ' + finalizeJson.detail : ''}`
            : `Synthesis failed (${finalizeRes.status})`,
        );
        return;
      }

      // Step 2: commit the position row
      setSaving(true);
      const commitRes = await fetch(
        `/api/partners/${encodeURIComponent(token)}/positions/${encodeURIComponent(captureId)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            completeness: 'interviewed',
            profile: finalizeJson.profile,
            model: finalizeJson.model,
            sessionId,
          }),
        },
      );
      if (!commitRes.ok) {
        const commitJson = await commitRes.json().catch(() => ({})) as { error?: string };
        setError(commitJson.error ? `Save failed: ${commitJson.error}` : `Save failed (${commitRes.status})`);
        return;
      }

      // Step 3: redirect to partner dashboard
      router.push(`/partners/${encodeURIComponent(token)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setGenerating(false);
      setSaving(false);
    }
  }

  function appendTranscript(text: string) {
    setInput(prev => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
  }

  // Guard: enable End button only once there's at least one partner answer
  const userAnswerCount = messages.filter(m => m.role === 'user').length;
  const canEnd = userAnswerCount >= 1 && !!sessionId && !busy && !generating && !saving;
  const isProcessing = generating || saving;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-800">AI Interview</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The interviewer will ask about how <strong>{positionTitle || 'this position'}</strong> connects to student preparation.
              There are no right answers — candid responses help most.
            </p>
          </div>
          {readinessScore !== null && (
            <div className="shrink-0 text-right">
              <p className="text-xs text-muted-foreground">Coverage</p>
              <p className="text-xl font-bold tabular-nums text-slate-800">{readinessScore}<span className="text-sm font-normal text-slate-500">/10</span></p>
            </div>
          )}
        </div>
      </section>

      {/* Message thread */}
      <div className="rounded-md border bg-card shadow-sm">
        <div className="max-h-[480px] overflow-y-auto space-y-3 px-4 py-4">
          {busy && messages.length === 0 ? (
            <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
              Starting interview…
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
                  {m.role === 'user' ? 'You' : 'Interviewer'}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-snug">{m.content}</p>
              </div>
            ))
          )}
          {busy && messages.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
              Thinking…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input area — only shown once the opening turn has loaded */}
        {messages.length > 0 && (
          <div className="border-t px-4 py-3 space-y-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Type a reply, or use voice. Enter to send, Shift+Enter for a new line."
              rows={3}
              disabled={busy || isProcessing}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
              onKeyDown={e => {
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
                disabled={busy || isProcessing}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleEnd()}
                  disabled={!canEnd || isProcessing}
                  title={userAnswerCount === 0 ? 'Answer at least one question before ending' : undefined}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  {generating ? 'Synthesizing…' : saving ? 'Saving…' : 'End interview & generate'}
                </button>
                <button
                  type="button"
                  onClick={() => void sendTurn()}
                  disabled={busy || isProcessing || !input.trim()}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

function buildAssistantText(response: AuditResponse): string {
  return [response.finding, response.question].filter(Boolean).join('\n\n');
}
