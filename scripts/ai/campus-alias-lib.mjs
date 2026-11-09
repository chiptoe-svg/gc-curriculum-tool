/**
 * Pure logic for the daily campus-alias check (Part 2 Task 7). The RCD
 * aliases tiger and cub move between models without notice; the app names
 * exact ids (lib/ai/models.ts CAMPUS_MODELS). The check compares the model
 * each alias serves with the model its pinned id serves.
 */

export const LABEL = 'campus-alias';
export const ISSUE_TITLE = 'A campus model alias moved (tiger/cub no longer serve the pinned model)';
/** Alias → the exact id it was pinned against (Part 2 spec, 2026-11-01). */
export const PINNED = { tiger: 'glm-5.3', cub: 'qwen3.8-27b-fp8' };

const norm = id => String(id).toLowerCase().split('/').pop().trim();

/** true moved, false same, null when either side could not be read. */
export function aliasMoved(aliasServed, pinnedServed) {
  if (!aliasServed || !pinnedServed) return null;
  return norm(aliasServed) !== norm(pinnedServed);
}

/** 'open' | 'close' | 'none' for the one campus-alias issue. Unknown probes change nothing. */
export function decideIssue(results, hasOpenIssue) {
  if (results.some(r => r.moved === null)) return 'none';
  const moved = results.some(r => r.moved === true);
  if (moved) return hasOpenIssue ? 'none' : 'open';
  return hasOpenIssue ? 'close' : 'none';
}

export function issueBody(results, checkedAt) {
  const lines = results.map(r => `- \`${r.alias}\` serves \`${r.aliasServed ?? '?'}\`; pinned \`${r.pinned}\` serves \`${r.pinnedServed ?? '?'}\`${r.moved ? ' — **moved**' : ''}`);
  return [
    `Checked ${checkedAt} by scripts/ai/campus-alias-check.mjs.`,
    '',
    ...lines,
    '',
    'The app uses exact ids, so nothing changed in the app. Benchmarks or notes that say "tiger"/"cub" now refer to a different model.',
    'This issue closes itself when the aliases match the pinned models again.',
  ].join('\n');
}
