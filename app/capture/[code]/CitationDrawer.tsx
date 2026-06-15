'use client';

import { useEffect, useState } from 'react';

export interface CitationTarget {
  type: 'chunk' | 'instructor';
  chunkId?: string | null;
  messageId?: string | null;
  excerpt?: string;
}

interface ChunkPayload {
  text: string;
  fileName: string;
  sectionTitle: string;
  sectionIndex: number;
  materialId: string;
  parentSectionText: string | null;
}

interface MessagePayload {
  id: string;
  role: string;
  turnIndex: number;
  content: string;
}

interface Props {
  courseCode: string;
  slug: string;
  target: CitationTarget | null;
  onClose: () => void;
}

export function CitationDrawer({ courseCode, slug, target, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chunk, setChunk] = useState<ChunkPayload | null>(null);
  const [message, setMessage] = useState<MessagePayload | null>(null);

  useEffect(() => {
    if (!target) return;
    setLoading(true);
    setError(null);
    setChunk(null);
    setMessage(null);

    const base = `/api/capture/${encodeURIComponent(courseCode)}`;
    const qs = `?slug=${encodeURIComponent(slug)}`;

    let cancelled = false;
    (async () => {
      try {
        if (target.type === 'chunk' && target.chunkId) {
          const res = await fetch(`${base}/chunks/${encodeURIComponent(target.chunkId)}${qs}`);
          // 404 = the chunk id doesn't resolve (e.g., synthetic id from
          // earlier prompt era). Treat as "excerpt-only" rather than an
          // error — the excerpt alone is enough to ground the citation.
          if (res.status === 404) {
            return;
          }
          if (!res.ok) throw new Error(`chunk lookup failed (${res.status})`);
          if (!cancelled) setChunk((await res.json()) as ChunkPayload);
        } else if (target.type === 'instructor' && target.messageId) {
          const res = await fetch(`${base}/messages/${encodeURIComponent(target.messageId)}${qs}`);
          // 404 = the synthesis prompt emitted a synthetic messageId
          // (e.g., "user_3") that doesn't correspond to a real DB row.
          // Older profiles from before the prompt was tightened can carry
          // these; the cited excerpt is shown unmodified by the caller —
          // no need to error, just leave message null.
          if (res.status === 404) {
            return;
          }
          if (!res.ok) throw new Error(`message lookup failed (${res.status})`);
          if (!cancelled) setMessage((await res.json()) as MessagePayload);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'lookup failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [target, courseCode, slug]);

  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <aside className="w-[min(560px,92vw)] overflow-y-auto border-l bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {target.type === 'chunk' ? 'Material excerpt' : 'Earlier turn'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-2 py-1 text-xs hover:bg-muted"
          >
            Close
          </button>
        </div>

        {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {chunk && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              <div><span className="font-medium text-foreground">File:</span> {chunk.fileName}</div>
              <div><span className="font-medium text-foreground">Section:</span> {chunk.sectionTitle || '(untitled)'} (#{chunk.sectionIndex})</div>
            </div>
            <pre className="whitespace-pre-wrap rounded bg-muted/40 p-3 text-xs leading-relaxed">{chunk.text}</pre>
            {chunk.parentSectionText && chunk.parentSectionText !== chunk.text && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Show full parent section
                </summary>
                <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/20 p-3 text-xs leading-relaxed">
                  {chunk.parentSectionText}
                </pre>
              </details>
            )}
          </div>
        )}

        {message && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {message.role === 'user' ? 'Instructor' : 'Interviewer'} · turn {message.turnIndex}
            </p>
            <pre className="whitespace-pre-wrap rounded bg-muted/40 p-3 text-sm leading-relaxed">{message.content}</pre>
          </div>
        )}

        {target.excerpt && !chunk && !message && !loading && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Synthesized citation — excerpt only
            </p>
            <p className="rounded bg-muted/40 px-3 py-2 text-sm leading-relaxed text-foreground">
              {target.excerpt}
            </p>
            <p className="text-[11px] text-muted-foreground">
              The synthesizer included this excerpt to ground a finding without linking
              to a specific transcript turn. The full turn isn&apos;t directly resolvable —
              the excerpt above is what the synthesizer is citing.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
