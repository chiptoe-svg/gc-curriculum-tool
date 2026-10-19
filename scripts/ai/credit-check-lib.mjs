// Pure helpers for scripts/ai/credit-check.mjs (unit-tested in tests/scripts/credit-check.test.ts).

export const LABEL = 'ai-credits';
export const ISSUE_TITLE = "Clemson shared OpenAI credits are used up";
export const DEFAULT_PROBE_MODEL = 'gpt-4.1-nano';

const EXHAUSTED = /quota_denied|shared credits are exhausted/;

/** Probe response -> 'ok' | 'exhausted' | 'unknown'. Only the gateway's quota body counts as exhausted. */
export function classifyProbe({ status, body, error } = {}) {
  if (error || typeof status !== 'number') return 'unknown';
  if (status >= 200 && status < 300) return 'ok';
  if (EXHAUSTED.test(body ?? '')) return 'exhausted';
  return 'unknown';
}

/** What to do with the alert issue: 'open' | 'close' | 'none'. */
export function decideAlert({ state, hasOpenIssue }) {
  if (state === 'exhausted') return hasOpenIssue ? 'none' : 'open';
  if (state === 'ok') return hasOpenIssue ? 'close' : 'none';
  return 'none';
}

/** New status-file content from a probe result, or null to leave the file alone. */
export function nextStatus(prev, result, detail, nowIso) {
  if (result === 'unknown' && prev && prev.status === 'exhausted') return null; // never mask a known outage
  const keepSince = prev && prev.status === result && prev.since;
  return { status: result, since: keepSince || nowIso, checkedAt: nowIso, source: 'probe', detail };
}

/** launchd WatchPaths run (trigger touched after the last run) vs a scheduled probe run. mtimes in ms or null. */
export function isTriggerRun(triggerMtimeMs, lastRunMtimeMs) {
  if (triggerMtimeMs == null) return false;
  if (lastRunMtimeMs == null) return true;
  return triggerMtimeMs > lastRunMtimeMs;
}

export function issueBody(s) {
  return `Clemson's shared OpenAI credits (the RCD gateway) are used up, so every AI call fails with \`quota_denied\`.\n\n`
    + `- Exhausted since: ${s.since}\n- Last checked: ${s.checkedAt}\n- Detected by: ${s.source}\n- Detail: ${s.detail || '(none)'}\n\n`
    + `**What faculty see:** a banner on the capture pages, and in the interview, scoring and stress-test steps: `
    + `"The AI interview is paused because Clemson's shared OpenAI credits are used up. Your saved work is safe. ... has been notified — please try again later." `
    + `Saved work is unaffected.\n\n`
    + `Ask Clemson RCD to release more credits. This issue closes automatically at the next check (7am, noon, 4pm) once calls succeed again.`;
}
