'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AggregatePanelProps {
  targetId: string;
  slug: string;
  initialMarkdown: string | null;
  initialStale: boolean;
  initialGeneratedAt: Date | null;
}

export function AggregatePanel({
  targetId,
  slug,
  initialMarkdown,
  initialStale,
  initialGeneratedAt,
}: AggregatePanelProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [stale, setStale] = useState(initialStale);
  const [generatedAt, setGeneratedAt] = useState(initialGeneratedAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/synthesis/targets/${targetId}/regenerate-aggregate?slug=${encodeURIComponent(slug)}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { ok: boolean; markdown: string };
      setMarkdown(data.markdown);
      setStale(false);
      setGeneratedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Regenerate failed');
    } finally {
      setLoading(false);
    }
  }

  const hasContent = markdown && markdown.trim().length > 0;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Aggregate</h2>
          {stale && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Stale — new submissions since last run
            </span>
          )}
          {generatedAt && (
            <span className="text-xs text-slate-500">
              Last generated {new Date(generatedAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <button
          onClick={handleRegenerate}
          disabled={loading}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {!hasContent ? (
        <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          No interviewed positions yet. Once a partner completes the interview section, click &ldquo;Regenerate&rdquo; to build the aggregate view.
        </div>
      ) : (
        <div className="rounded border bg-white px-5 py-4 prose prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      )}
    </section>
  );
}
