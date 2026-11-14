'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { apiErrorText } from '@/lib/ai/credit-client';
import { readNdjson } from '@/lib/client/read-ndjson';
import { WHAT_IF_COPY } from '@/lib/what-if/copy';
import { changeText, kudText } from '@/lib/what-if/format-rating';
import type { QuickEstimate } from '@/lib/what-if/agent-tools';

interface ChatLine { key: string; role: 'user' | 'assistant'; content: string; estimates: QuickEstimate[] }
interface AttachmentLine { key: string; fileName: string; text: string }

export interface InitialAttachment {
  id: string; fileName: string; status: 'ok' | 'failed' | 'held_back'; heldBackReason: string | null;
}

const attachmentText = (status: InitialAttachment['status'], reason: string | null) =>
  status === 'ok' ? WHAT_IF_COPY.attachmentOk
    : status === 'failed' ? WHAT_IF_COPY.attachmentFailed
    : reason ? `${WHAT_IF_COPY.attachmentHeldBack}: ${reason}` : WHAT_IF_COPY.attachmentHeldBack;

/** One quick estimate, drawn from the event's own data: only the ratings it would move or add. */
function EstimateCard({ q }: { q: QuickEstimate }) {
  const moved = q.profile.ratings.filter(r => r.status !== 'approved');
  return (
    <div className="mt-2 rounded border bg-background px-3 py-2 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {WHAT_IF_COPY.estimateHeading}{q.candidate ? ` — ${q.candidate}` : ''}
      </p>
      {moved.length === 0 ? (
        <p className="mt-1">{WHAT_IF_COPY.estimateNothingMoved}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {moved.map((r, i) => (
            <li key={i}>
              <span className="font-medium">{r.statement}</span>{' '}
              <span className="font-semibold">{WHAT_IF_COPY.predictedLabel}</span>
              {' · '}
              <span>{r.status === 'new' ? `${WHAT_IF_COPY.newRating} (${kudText(r.kud)})` : (changeText(r.before, r.kud) ?? kudText(r.kud))}</span>
              {r.confidence && <> · <span>{WHAT_IF_COPY.confidence(r.confidence)}</span></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A thin chat panel for a what-if. Not a mode of the interview's panel: this one reads and
 * writes only the what-if's own conversation, and carries the attach control the interview lacks.
 */
export function WhatIfChatPanel({
  courseCode,
  whatIfId,
  slug,
  hasPage,
  initialAttachments = [],
}: {
  courseCode: string;
  whatIfId: string;
  slug: string;
  hasPage: boolean;
  initialAttachments?: InitialAttachment[];
}) {
  const router = useRouter();
  const api = `/api/explore/${encodeURIComponent(courseCode)}/what-ifs/${whatIfId}`;
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploads, setUploads] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentLine[]>(
    initialAttachments.map(a => ({ key: a.id, fileName: a.fileName, text: attachmentText(a.status, a.heldBackReason) })),
  );
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${api}/messages`);
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) { setError(apiErrorText(json, WHAT_IF_COPY.loadMessagesFailed)); return; }
        const rows = (json.messages ?? []) as Array<{ id: string; role: 'user' | 'assistant'; content: string; meta: { quickEstimates?: QuickEstimate[] } | null }>;
        setLines(rows.map(m => ({ key: m.id, role: m.role, content: m.content, estimates: m.meta?.quickEstimates ?? [] })));
      } catch {
        if (!cancelled) setError(WHAT_IF_COPY.loadMessagesFailed);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => {
    transcriptRef.current?.scrollTo?.({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines, pending]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setPending(text);
    setStatus(WHAT_IF_COPY.thinking);
    try {
      const res = await fetch(`${api}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) {
        setError(apiErrorText(await res.json().catch(() => ({})), WHAT_IF_COPY.chatFailed));
        return;
      }
      const estimates: QuickEstimate[] = [];
      let reply: string | null = null;
      let failure: string | null = null;
      await readNdjson(res, (ev) => {
        const e = ev as { kind: string } & Record<string, unknown>;
        if (e.kind === 'tool-start') setStatus(WHAT_IF_COPY.lookingUp);
        else if (e.kind === 'estimate' && e.estimate) estimates.push(e.estimate as QuickEstimate);
        else if (e.kind === 'final' && e.response && typeof (e.response as { response?: unknown }).response === 'string') {
          reply = (e.response as { response: string }).response;
        } else if (e.kind === 'error') {
          failure = typeof e.message === 'string' && e.message ? e.message : WHAT_IF_COPY.chatFailed;
        }
      });
      // A failed turn stores nothing on the server, so the typed text stays in the box for a retry.
      if (failure !== null || reply === null) { setError(failure ?? WHAT_IF_COPY.chatFailed); return; }
      const k = Date.now();
      setLines(prev => [
        ...prev,
        { key: `u${k}`, role: 'user', content: text, estimates: [] },
        { key: `a${k}`, role: 'assistant', content: reply as string, estimates },
      ]);
      setInput('');
    } catch {
      setError(WHAT_IF_COPY.chatFailed);
    } finally {
      setBusy(false);
      setPending(null);
      setStatus('');
    }
  }

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setUploads(n => n + files.length);
    await Promise.all(files.map(async (f) => {
      const key = `${Date.now()}-${f.name}-${Math.random()}`;
      const put = (text: string) => setAttachments(prev => {
        const i = prev.findIndex(a => a.key === key);
        const line = { key, fileName: f.name, text };
        return i === -1 ? [...prev, line] : prev.map((a, n) => (n === i ? line : a));
      });
      put(WHAT_IF_COPY.attaching(f.name));
      try {
        const form = new FormData();
        form.append('file', f);
        const res = await fetch(`${api}/attachments`, { method: 'POST', body: form });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.attachment) { put(apiErrorText(json, WHAT_IF_COPY.attachmentUploadFailed)); return; }
        put(attachmentText(json.attachment.status, json.attachment.heldBackReason ?? null));
      } catch {
        put(WHAT_IF_COPY.attachmentUploadFailed);
      } finally {
        setUploads(n => n - 1);
      }
    }));
  }

  async function createPage() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${api}/page`, { method: 'POST' });
      if (!res.ok) { setError(apiErrorText(await res.json().catch(() => ({})), WHAT_IF_COPY.pageFailed)); return; }
      router.push(`/explore/${encodeURIComponent(courseCode)}/what-ifs/${whatIfId}?slug=${encodeURIComponent(slug)}`);
    } catch {
      setError(WHAT_IF_COPY.pageFailed);
    } finally {
      setCreating(false);
    }
  }

  const empty = loaded && lines.length === 0 && pending === null;

  return (
    <section
      data-testid="what-if-panel"
      className="rounded-md border bg-card shadow-sm"
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); void upload(Array.from(e.dataTransfer?.files ?? [])); }}
    >
      <div className="border-b px-4 py-2">
        <h2 className="text-sm font-semibold">{WHAT_IF_COPY.talkHeading}</h2>
        <p className="text-xs text-muted-foreground">{WHAT_IF_COPY.talkIntro}</p>
      </div>

      <div ref={transcriptRef} className="max-h-[55vh] min-h-[240px] space-y-3 overflow-y-auto px-4 py-3">
        {empty && (
          <div className="mr-12 rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{WHAT_IF_COPY.assistantLabel}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{WHAT_IF_COPY.opening}</p>
          </div>
        )}
        {lines.map(m => (m.role === 'user' ? (
          <div key={m.key} className="ml-12 rounded-lg bg-primary/10 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{WHAT_IF_COPY.youLabel}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-snug">{m.content}</p>
          </div>
        ) : (
          <div key={m.key} className="mr-12 rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{WHAT_IF_COPY.assistantLabel}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
            {m.estimates.map((q, i) => <EstimateCard key={i} q={q} />)}
          </div>
        )))}
        {pending !== null && (
          <>
            <div className="ml-12 rounded-lg bg-primary/10 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{WHAT_IF_COPY.youLabel}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-snug">{pending}</p>
            </div>
            <p className="text-xs italic text-muted-foreground">{status}</p>
          </>
        )}
      </div>

      {error && (
        <div role="alert" className="mx-4 my-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="border-t px-4 pb-4 pt-4">
        <label htmlFor="what-if-reply" className="block text-xs font-medium text-muted-foreground">{WHAT_IF_COPY.replyLabel}</label>
        <textarea
          id="what-if-reply"
          value={input}
          disabled={busy}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
          }}
          onPaste={e => {
            const images = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
            if (images.length > 0) { e.preventDefault(); void upload(images); }
          }}
          rows={3}
          placeholder={WHAT_IF_COPY.replyPlaceholder}
          className="mt-1.5 w-full resize-y rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <VoiceRecorder slug={slug} onTranscript={t => setInput(prev => (prev.trim() ? `${prev.trim()}\n\n${t}` : t))} disabled={busy} />
            <label className="cursor-pointer rounded border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted">
              <input
                type="file"
                multiple
                aria-label={WHAT_IF_COPY.attach}
                className="sr-only"
                onChange={e => { void upload(Array.from(e.target.files ?? [])); e.target.value = ''; }}
              />
              {WHAT_IF_COPY.attach}
            </label>
          </div>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || busy}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? WHAT_IF_COPY.sending : WHAT_IF_COPY.send}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{WHAT_IF_COPY.attachHint}</p>
        {attachments.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {attachments.map(a => (
              <li key={a.key}><span className="font-medium">{a.fileName}</span> — <span>{a.text}</span></li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t px-4 py-4">
        <button
          type="button"
          onClick={() => void createPage()}
          disabled={lines.length === 0 || busy || creating || uploads > 0}
          className="w-full rounded-md border border-input bg-background px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
        >
          {hasPage ? WHAT_IF_COPY.updatePage : WHAT_IF_COPY.createPage}
        </button>
        {creating && <p className="mt-2 text-center text-sm text-muted-foreground">{WHAT_IF_COPY.creatingPage}</p>}
      </div>
    </section>
  );
}
