'use client';

import { useState } from 'react';

/** Copies the plain-text guide. Clipboard needs a secure context (campus
 *  HTTPS); on plain HTTP it reports failure and the "Show as plain text"
 *  disclosure below is the fallback. */
export function CopyGuideButton({ text }: { text: string }) {
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
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy as text'}
    </button>
  );
}
