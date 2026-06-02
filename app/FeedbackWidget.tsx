'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { OPEN_FEEDBACK_EVENT } from './FeedbackLink';

const NAME_KEY = 'gc-feedback-name';

export function FeedbackWidget() {
  const pathname = usePathname();
  const search = useSearchParams();
  const slug = search.get('slug') ?? '';

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ url: string; number: number } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(NAME_KEY);
      if (saved) setName(saved);
    }
  }, []);

  // Listen for the trigger event dispatched by <FeedbackLink /> in route
  // headers. Decoupling the trigger from the modal lets headers render a
  // plain text link without threading state down through every layout.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_FEEDBACK_EVENT, handler);
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, handler);
  }, []);

  if (!slug) return null;
  if (pathname?.startsWith('/partners/') || pathname?.startsWith('/preview/')) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const trimmed = text.trim();
      if (trimmed.length < 5) {
        setError('Please describe the issue or idea in a sentence or two.');
        return;
      }
      const route = (pathname ?? '') + (search.toString() ? `?${search.toString()}` : '');
      const res = await fetch(`/api/feedback?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || null,
          feedback: trimmed,
          route,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((json as { error?: string }).error ?? `Failed (${res.status})`);
        return;
      }
      if (name.trim() && typeof window !== 'undefined') {
        window.localStorage.setItem(NAME_KEY, name.trim());
      }
      const { issueUrl, issueNumber } = json as { issueUrl: string; issueNumber: number };
      setPosted({ url: issueUrl, number: issueNumber });
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setOpen(false);
    setPosted(null);
    setError(null);
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={reset}>
          <div
            className="w-full max-w-md rounded-lg border bg-card p-4 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Send feedback</h3>
              <button
                type="button"
                onClick={reset}
                className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
              >
                Close
              </button>
            </div>

            {posted ? (
              <div className="space-y-3">
                <p className="text-sm">Thanks — filed as <strong>#{posted.number}</strong>.</p>
                <p className="text-xs text-muted-foreground">
                  <a className="underline" href={posted.url} target="_blank" rel="noreferrer">View on GitHub</a> · You can keep working; we&apos;ll follow up.
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setPosted(null); }} className="rounded border px-3 py-1.5 text-xs hover:bg-muted">Send another</button>
                  <button type="button" onClick={reset} className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">Done</button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium" htmlFor="fb-name">
                    Your name <span className="font-normal text-muted-foreground">(so we know who to follow up with — skip if you&apos;d rather stay anonymous)</span>
                  </label>
                  <input
                    id="fb-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Erica Walker"
                    className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium" htmlFor="fb-text">
                    What&apos;s on your mind? <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    id="fb-text"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    rows={5}
                    placeholder="Bug, idea, confusion, anything. What page were you on and what were you trying to do?"
                    className="mt-1 w-full resize-y rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    required
                  />
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <div className="flex items-center justify-between gap-3 pt-1">
                  <p className="text-[11px] text-muted-foreground">
                    We&apos;ll capture the page you&apos;re on automatically.
                  </p>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
                  >
                    {busy ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
