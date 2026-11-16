// A proposal only: the revised-Bloom process a written objective's leading verb suggests. Faculty confirm or change it.
import { BLOOM, type BloomProcess } from './types';
export { BLOOM };
export type { BloomProcess };

const VERBS: Record<BloomProcess, string[]> = {
  Remember: ['identify', 'list', 'name', 'recall', 'recognize', 'define', 'state', 'label'],
  Understand: ['explain', 'describe', 'summarize', 'classify', 'interpret', 'discuss', 'illustrate'],
  Apply: ['apply', 'use', 'prepare', 'operate', 'execute', 'implement', 'set up', 'demonstrate', 'perform'],
  Analyze: ['analyze', 'compare', 'diagnose', 'differentiate', 'examine', 'troubleshoot', 'distinguish'],
  Evaluate: ['evaluate', 'judge', 'critique', 'assess', 'justify', 'select', 'defend'],
  Create: ['create', 'design', 'produce', 'develop', 'plan', 'compose', 'build', 'construct'],
};

const LEAD = /^\s*(?:students?\s+(?:will\s+)?(?:be\s+able\s+to\s+)?|(?:will\s+)?be\s+able\s+to\s+)/i;

/** Process named by the objective's leading verb (after any "Students will (be able to)"), or null when none matches. */
export function proposeBloom(text: string): BloomProcess | null {
  const t = text.replace(LEAD, '').trim().toLowerCase();
  let best: { p: BloomProcess; len: number } | null = null;
  for (const p of BLOOM) for (const v of VERBS[p]) {
    if ((t === v || t.startsWith(v + ' ')) && (!best || v.length > best.len)) best = { p, len: v.length };
  }
  return best?.p ?? null;
}
