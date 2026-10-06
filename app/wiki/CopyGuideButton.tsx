'use client';

import { useState } from 'react';

/** Copies the given text (the plain-text guide, or the Canvas AI prompt).
 *  Clipboard needs a secure context (campus HTTPS); on plain HTTP it reports
 *  failure and the disclosure's visible text block below is the fallback. */
export function CopyGuideButton({ text, label = 'Copy as text' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <button type="button" className="wiki-assess__copy" onClick={() => void copy()}>
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
