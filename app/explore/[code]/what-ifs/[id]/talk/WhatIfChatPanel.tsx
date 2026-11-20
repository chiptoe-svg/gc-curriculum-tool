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
    <div className="ex-estimate">
      <p className="ex-label">
        {WHAT_IF_COPY.estimateHeading}{q.candidate ? ` — ${q.candidate}` : ''}
      </p>
      {moved.length === 0 ? (
        <p className="mt-1">{WHAT_IF_COPY.estimateNothingMoved}</p>
      ) : (
        <ul>
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
      className="ex-card ex-chat"
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); void upload(Array.from(e.dataTransfer?.files ?? [])); }}
    >
      <div className="ex-card-head">
        <h2 className="ex-h2" style={{ fontSize: 20 }}>{WHAT_IF_COPY.talkHeading}</h2>
        <p className="ex-meta">{WHAT_IF_COPY.talkIntro}</p>
      </div>

      <div ref={transcriptRef} className="ex-transcript">
        {empty && (
          <div className="ex-msg">
            <p className="ex-label">{WHAT_IF_COPY.assistantLabel}</p>
            <p>{WHAT_IF_COPY.opening}</p>
          </div>
        )}
        {lines.map(m => (m.role === 'user' ? (
          <div key={m.key} className="ex-msg ex-msg-user">
            <p className="ex-label">{WHAT_IF_COPY.youLabel}</p>
            <p>{m.content}</p>
          </div>
        ) : (
          <div key={m.key} className="ex-msg">
            <p className="ex-label">{WHAT_IF_COPY.assistantLabel}</p>
            <p>{m.content}</p>
            {m.estimates.map((q, i) => <EstimateCard key={i} q={q} />)}
          </div>
        )))}
        {pending !== null && (
          <>
            <div className="ex-msg ex-msg-user">
              <p className="ex-label">{WHAT_IF_COPY.youLabel}</p>
              <p>{pending}</p>
            </div>
            <p className="ex-meta" style={{ fontStyle: 'italic' }}>{status}</p>
          </>
        )}
      </div>

      {error && (
        <div role="alert" className="ex-alert ex-chat-alert">
          {error}
        </div>
      )}

      <div className="ex-card-foot">
        <label htmlFor="what-if-reply" className="ex-label">{WHAT_IF_COPY.replyLabel}</label>
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
          className="ex-textarea mt-2"
        />
        <div className="ex-row mt-3" style={{ justifyContent: 'space-between' }}>
          <div className="ex-row">
            <VoiceRecorder slug={slug} onTranscript={t => setInput(prev => (prev.trim() ? `${prev.trim()}\n\n${t}` : t))} disabled={busy} />
            <label className="ex-btn ex-btn-sm ex-file">
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
            className="ex-btn ex-btn-primary"
          >
            {busy ? WHAT_IF_COPY.sending : WHAT_IF_COPY.send}
          </button>
        </div>
        <p className="ex-meta mt-2">{WHAT_IF_COPY.attachHint}</p>
        {attachments.length > 0 && (
          <ul className="ex-body mt-2" style={{ listStyle: 'none', padding: 0 }}>
            {attachments.map(a => (
              <li key={a.key}><span className="font-medium">{a.fileName}</span> — <span>{a.text}</span></li>
            ))}
          </ul>
        )}
      </div>

      <div className="ex-card-foot">
        <button
          type="button"
          onClick={() => void createPage()}
          disabled={lines.length === 0 || busy || creating || uploads > 0}
          className="ex-btn ex-btn-block"
        >
          {hasPage ? WHAT_IF_COPY.updatePage : WHAT_IF_COPY.createPage}
        </button>
        {creating && <p className="ex-meta mt-2 text-center">{WHAT_IF_COPY.creatingPage}</p>}
      </div>
    </section>
  );
}
