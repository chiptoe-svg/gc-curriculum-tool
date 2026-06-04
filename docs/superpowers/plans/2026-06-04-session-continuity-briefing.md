# Session-Continuity Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the audit agent's verbose "Prior audit sessions" raw-transcript dump with a deterministic, structured Session Briefing assembled by quoting already-persisted `capture_messages` data — and surface the same data to faculty as a "Where we left off" recap.

**Architecture:** A new pure module `lib/ai/agent/session-briefing.ts` owns (a) parsing a stored assistant turn's JSON into a typed `ParsedAssistantTurn`, (b) `composeSessionBriefing` (prior-session summaries → structured `SessionBriefing[]`, all verbatim), and (c) `renderBriefing` (briefings → compact at-rest text block). `listPriorSessionSummaries` is extended to expose the parsed assistant turns + last faculty turn the composer needs. `buildAgentCall` swaps its inline `priorSessionsBlock` for `renderBriefing(composeSessionBriefing(priorSessions))`. The `/capture/[code]` page computes the same briefings server-side and prop-drills a serializable view into `CaptureChatPanel` for a collapsed recap card. No new AI call, no migration.

**Tech Stack:** TypeScript (strict), Next.js 15 App Router (RSC + client components), Drizzle (read-only here), Vitest. Spec: `docs/superpowers/specs/2026-06-04-session-continuity-briefing-design.md`.

---

## File Structure

- **Create** `lib/ai/agent/session-briefing.ts` — pure module: types (`StoredReadiness`, `ParsedAssistantTurn`, `BriefingFinding`, `SessionBriefing`), `parseAssistantContent`, `composeSessionBriefing`, `renderBriefing`. No runtime DB import (type-only imports from the query module).
- **Create** `tests/lib/ai/agent/session-briefing.test.ts` — unit tests for the pure module.
- **Modify** `lib/db/capture-messages-queries.ts` — extend `PriorSessionSummary` (add `assistantTurns`, `lastFacultyTurn`; remove `recentTurns`, `lastAssistantContent`, `lastAssistantReadiness` in Task 4), populate via `parseAssistantContent`.
- **Modify** `lib/ai/agent/audit-agent.ts` — replace the inline `priorSessionsBlock` (lines 136–163) with the rendered briefing.
- **Modify** `tests/lib/ai/agent/audit-agent.test.ts` — add an integration assertion that the briefing block is present and the old dump is gone.
- **Modify** `app/capture/[code]/page.tsx` — compute briefings, pass a serializable `SessionBriefingView[]` down.
- **Modify** `app/capture/[code]/CaptureClient.tsx` — thread the prop through.
- **Modify** `app/capture/[code]/CaptureChatPanel.tsx` — accept the prop, define+export `SessionBriefingView`, render the "Where we left off" card.
- **Modify** `docs/STATE.md` — flip the spec row to "plan written / shipped."

**Dependency-direction note (avoids a runtime cycle):** `capture-messages-queries.ts` imports `parseAssistantContent` (value) + `ParsedAssistantTurn` (`import type`) from `session-briefing.ts`. `session-briefing.ts` imports `PriorSessionSummary` and `CaptureMessageCitation` from the query module **with `import type` only** (erased at compile, no runtime edge). `session-briefing.ts` must have **no runtime import** of the query module or `@/lib/db/client`.

---

## Task 1: Pure module skeleton — types + `parseAssistantContent`

**Files:**
- Create: `lib/ai/agent/session-briefing.ts`
- Create: `tests/lib/ai/agent/session-briefing.test.ts`

- [ ] **Step 1: Write the failing test for `parseAssistantContent`**

Create `tests/lib/ai/agent/session-briefing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseAssistantContent } from '@/lib/ai/agent/session-briefing';

describe('parseAssistantContent', () => {
  it('parses a stored AuditResponse JSON into finding/citations/readiness', () => {
    const content = JSON.stringify({
      finding: 'GC 3450 projects reach D=3 on layout.',
      question: 'What about prereqs?',
      citations: [{ type: 'chunk', chunkId: '8a1f0c11-aaaa', excerpt: 'x' }],
      readiness: { score: 70, covered: ['outcomes'], remaining: ['prereqs'], good_enough_to_generate: false },
    });
    const out = parseAssistantContent(content);
    expect(out).not.toBeNull();
    expect(out!.finding).toBe('GC 3450 projects reach D=3 on layout.');
    expect(out!.citations).toEqual([{ type: 'chunk', chunkId: '8a1f0c11-aaaa', excerpt: 'x' }]);
    expect(out!.readiness).toEqual({ score: 70, covered: ['outcomes'], remaining: ['prereqs'] });
  });

  it('returns null for null/empty content', () => {
    expect(parseAssistantContent(null)).toBeNull();
    expect(parseAssistantContent('')).toBeNull();
  });

  it('returns null for non-JSON content', () => {
    expect(parseAssistantContent('not json at all')).toBeNull();
  });

  it('tolerates missing citations/readiness (defaults, no throw)', () => {
    const out = parseAssistantContent(JSON.stringify({ finding: 'Just a finding.' }));
    expect(out).toEqual({ finding: 'Just a finding.', citations: [], readiness: null });
  });

  it('keeps a turn that has readiness but an empty finding', () => {
    const out = parseAssistantContent(JSON.stringify({
      finding: '',
      readiness: { score: 30, covered: [], remaining: ['x'], good_enough_to_generate: false },
    }));
    expect(out).not.toBeNull();
    expect(out!.readiness).toEqual({ score: 30, covered: [], remaining: ['x'] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/lib/ai/agent/session-briefing.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ai/agent/session-briefing"` / `parseAssistantContent is not a function`.

- [ ] **Step 3: Create the module with types + `parseAssistantContent`**

Create `lib/ai/agent/session-briefing.ts`:

```ts
/**
 * Deterministic, verbatim session-continuity briefing for the audit agent.
 * Pure module — NO runtime DB import (type-only imports below are erased).
 * See docs/superpowers/specs/2026-06-04-session-continuity-briefing-design.md
 */
import type { PriorSessionSummary, CaptureMessageCitation } from '@/lib/db/capture-messages-queries';

export interface StoredReadiness {
  score: number | null;
  covered: string[];
  remaining: string[];
}

export interface ParsedAssistantTurn {
  finding: string;
  citations: CaptureMessageCitation[];
  readiness: StoredReadiness | null;
}

export interface BriefingFinding {
  text: string;
  citations: CaptureMessageCitation[];
}

export interface SessionBriefing {
  sessionId: string;
  startedAt: Date;
  turnCount: number;
  readiness: StoredReadiness;
  stickyFindings: BriefingFinding[];
  lastFacultyTurn: string | null;
}

const MAX_FINDINGS = 3;
const FINDING_CHAR_CAP = 600;
const FACULTY_CHAR_CAP = 600;

function cap(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function isCitation(v: unknown): v is CaptureMessageCitation {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (c.type === 'chunk' || c.type === 'instructor') && typeof c.excerpt === 'string';
}

function normalizeReadiness(v: unknown): StoredReadiness | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  return {
    score: typeof r.score === 'number' ? r.score : null,
    covered: Array.isArray(r.covered) ? (r.covered as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    remaining: Array.isArray(r.remaining) ? (r.remaining as unknown[]).filter((x): x is string => typeof x === 'string') : [],
  };
}

/**
 * Parse a stored assistant-turn `content` string (a JSON-stringified
 * AuditResponse) into typed fields. Returns null when the content is
 * absent, not JSON, or carries no usable signal.
 */
export function parseAssistantContent(content: string | null): ParsedAssistantTurn | null {
  if (!content || content.length === 0) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
  const finding = typeof parsed.finding === 'string' ? parsed.finding : '';
  const citations = Array.isArray(parsed.citations)
    ? (parsed.citations as unknown[]).filter(isCitation)
    : [];
  const readiness = normalizeReadiness(parsed.readiness);
  if (!finding && citations.length === 0 && !readiness) return null;
  return { finding, citations, readiness };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/lib/ai/agent/session-briefing.test.ts`
Expected: PASS (5 tests in the `parseAssistantContent` describe).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/agent/session-briefing.ts tests/lib/ai/agent/session-briefing.test.ts
git commit -m "feat(capture): session-briefing module skeleton + parseAssistantContent"
```

---

## Task 2: `composeSessionBriefing` (pure)

**Files:**
- Modify: `lib/ai/agent/session-briefing.ts`
- Test: `tests/lib/ai/agent/session-briefing.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/ai/agent/session-briefing.test.ts`:

```ts
import { composeSessionBriefing } from '@/lib/ai/agent/session-briefing';
import type { PriorSessionSummary } from '@/lib/db/capture-messages-queries';

function makePrior(overrides: Partial<PriorSessionSummary> = {}): PriorSessionSummary {
  return {
    sessionId: '4f3a1b2c-dddd-eeee-ffff-000000000000',
    startedAt: new Date('2026-05-30T00:00:00Z'),
    turnCount: 12,
    assistantTurns: [],
    lastFacultyTurn: null,
    ...overrides,
  };
}

describe('composeSessionBriefing', () => {
  it('returns [] for no prior sessions', () => {
    expect(composeSessionBriefing([])).toEqual([]);
  });

  it('takes readiness from the most recent turn that recorded one', () => {
    const [b] = composeSessionBriefing([makePrior({
      assistantTurns: [
        { finding: 'old', citations: [], readiness: { score: 40, covered: ['a'], remaining: ['b'] } },
        { finding: 'new', citations: [], readiness: { score: 70, covered: ['a', 'c'], remaining: ['d'] } },
      ],
    })]);
    expect(b!.readiness).toEqual({ score: 70, covered: ['a', 'c'], remaining: ['d'] });
  });

  it('carries up to 3 distinct findings, newest first', () => {
    const [b] = composeSessionBriefing([makePrior({
      assistantTurns: [
        { finding: 'f1', citations: [], readiness: null },
        { finding: 'f2', citations: [], readiness: null },
        { finding: 'f3', citations: [], readiness: null },
        { finding: 'f4', citations: [], readiness: null },
      ],
    })]);
    expect(b!.stickyFindings.map(f => f.text)).toEqual(['f4', 'f3', 'f2']);
  });

  it('dedupes findings by whitespace-normalized text', () => {
    const [b] = composeSessionBriefing([makePrior({
      assistantTurns: [
        { finding: 'Same   finding.', citations: [], readiness: null },
        { finding: 'same finding.', citations: [], readiness: null },
      ],
    })]);
    expect(b!.stickyFindings).toHaveLength(1);
    expect(b!.stickyFindings[0]!.text).toBe('same finding.');
  });

  it('skips empty findings and preserves citations on kept ones', () => {
    const cite = { type: 'chunk' as const, chunkId: 'c1', excerpt: 'x' };
    const [b] = composeSessionBriefing([makePrior({
      assistantTurns: [
        { finding: '   ', citations: [], readiness: null },
        { finding: 'real', citations: [cite], readiness: null },
      ],
    })]);
    expect(b!.stickyFindings).toEqual([{ text: 'real', citations: [cite] }]);
  });

  it('caps finding and faculty text length', () => {
    const long = 'x'.repeat(800);
    const [b] = composeSessionBriefing([makePrior({
      assistantTurns: [{ finding: long, citations: [], readiness: null }],
      lastFacultyTurn: long,
    })]);
    expect(b!.stickyFindings[0]!.text).toBe('x'.repeat(600) + '…');
    expect(b!.lastFacultyTurn).toBe('x'.repeat(600) + '…');
  });

  it('defaults readiness when no turn recorded one', () => {
    const [b] = composeSessionBriefing([makePrior({
      assistantTurns: [{ finding: 'f', citations: [], readiness: null }],
    })]);
    expect(b!.readiness).toEqual({ score: null, covered: [], remaining: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/lib/ai/agent/session-briefing.test.ts`
Expected: FAIL — `composeSessionBriefing is not a function`. (Note: this also requires `PriorSessionSummary` to expose `assistantTurns` + `lastFacultyTurn`; Task 1 has not changed the type yet, so the test file may show a type error on `makePrior`. That is expected — it resolves when Task 3's query change lands. To keep this task self-contained, the failing-test signal we need is the missing export.)

- [ ] **Step 3: Implement `composeSessionBriefing`**

Append to `lib/ai/agent/session-briefing.ts`:

```ts
export function composeSessionBriefing(priorSessions: PriorSessionSummary[]): SessionBriefing[] {
  return priorSessions.map((s): SessionBriefing => {
    const turns = s.assistantTurns;

    // Readiness = the most recent turn that recorded one.
    let readiness: StoredReadiness = { score: null, covered: [], remaining: [] };
    for (let i = turns.length - 1; i >= 0; i--) {
      const r = turns[i]!.readiness;
      if (r) { readiness = r; break; }
    }

    // Sticky findings: newest-first, distinct by normalized text, up to MAX_FINDINGS.
    const seen = new Set<string>();
    const stickyFindings: BriefingFinding[] = [];
    for (let i = turns.length - 1; i >= 0 && stickyFindings.length < MAX_FINDINGS; i--) {
      const raw = (turns[i]!.finding ?? '').trim();
      if (!raw) continue;
      const norm = raw.replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      stickyFindings.push({ text: cap(raw.replace(/\s+/g, ' '), FINDING_CHAR_CAP), citations: turns[i]!.citations });
    }

    return {
      sessionId: s.sessionId,
      startedAt: s.startedAt,
      turnCount: s.turnCount,
      readiness,
      stickyFindings,
      lastFacultyTurn: s.lastFacultyTurn ? cap(s.lastFacultyTurn.trim().replace(/\s+/g, ' '), FACULTY_CHAR_CAP) : null,
    };
  });
}
```

> Note: the dedup test expects the kept text to be the whitespace-normalized form (`'same finding.'`), so `text` stores the normalized (collapsed-whitespace) string, matching the `norm` used for dedup minus the lowercasing. The test `'Same   finding.'` vs `'same finding.'`: newest-first means `'same finding.'` is encountered first and kept verbatim-but-collapsed → `'same finding.'`. ✓

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run tests/lib/ai/agent/session-briefing.test.ts`
Expected: the `composeSessionBriefing` describe PASSES. (If `makePrior` shows a TS error because `PriorSessionSummary` lacks the new fields, proceed to Task 3 which adds them, then re-run — they are designed to land together. The runtime assertions pass regardless because Vitest/esbuild does not type-check.)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/agent/session-briefing.ts tests/lib/ai/agent/session-briefing.test.ts
git commit -m "feat(capture): composeSessionBriefing — verbatim distinct-finding carry-forward"
```

---

## Task 3: Extend `PriorSessionSummary` + populate in the query

**Files:**
- Modify: `lib/db/capture-messages-queries.ts` (interface at 151–164; population in `listPriorSessionSummaries` 221–301)

- [ ] **Step 1: Add the import + new interface fields**

At the top of `lib/db/capture-messages-queries.ts`, after the existing imports (around line 14), add:

```ts
import { parseAssistantContent, type ParsedAssistantTurn } from '@/lib/ai/agent/session-briefing';
```

Replace the `PriorSessionSummary` interface (lines 151–164) with — note we **add** `assistantTurns` + `lastFacultyTurn` and **keep** the old fields for now so `audit-agent.ts` still compiles until Task 4:

```ts
export interface PriorSessionSummary {
  sessionId: string;
  startedAt: Date;
  lastAssistantContent: string | null;
  lastAssistantReadiness: unknown | null;
  turnCount: number;
  recentTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Parsed assistant turns in chronological order (turnIndex asc). Drives the structured session briefing. */
  assistantTurns: ParsedAssistantTurn[];
  /** The most recent faculty (user) message body for this session, raw. null if the session has no faculty turns. */
  lastFacultyTurn: string | null;
}
```

- [ ] **Step 2: Populate the new fields in `listPriorSessionSummaries`**

In the `for (const [sessionId, sessionRows] of bySession)` loop, after `sessionRows.sort((a, b) => a.turnIndex - b.turnIndex);` and before the `summaries.push({...})` call, add:

```ts
    const assistantTurns: ParsedAssistantTurn[] = sessionRows
      .filter(r => r.role === 'assistant')
      .map(r => parseAssistantContent(typeof r.content === 'string' ? r.content : null))
      .filter((t): t is ParsedAssistantTurn => t !== null);

    const lastFacultyRow = [...sessionRows].reverse().find(r => r.role === 'user');
    const lastFacultyTurn =
      lastFacultyRow && typeof lastFacultyRow.content === 'string' && lastFacultyRow.content.length > 0
        ? lastFacultyRow.content
        : null;
```

Then extend the existing `summaries.push({ ... })` object literal to include the two new fields:

```ts
    summaries.push({
      sessionId,
      startedAt: sessionRows[0]!.createdAt,
      lastAssistantContent: assistantText,
      lastAssistantReadiness: readiness,
      turnCount: sessionRows.length,
      recentTurns,
      assistantTurns,
      lastFacultyTurn,
    });
```

- [ ] **Step 3: Verify the whole suite still builds + passes**

Run: `pnpm exec vitest run tests/lib/ai/agent/session-briefing.test.ts`
Expected: PASS — `makePrior` now type-checks; all `parseAssistantContent` + `composeSessionBriefing` tests green.

Run: `pnpm exec tsc --noEmit`
Expected: no errors (no runtime import cycle; `audit-agent.ts` still uses the retained old fields).

- [ ] **Step 4: Commit**

```bash
git add lib/db/capture-messages-queries.ts
git commit -m "feat(capture): expose parsed assistant turns + last faculty turn on PriorSessionSummary"
```

---

## Task 4: `renderBriefing` + wire into `buildAgentCall`, remove the raw dump

**Files:**
- Modify: `lib/ai/agent/session-briefing.ts` (add `renderBriefing`)
- Modify: `tests/lib/ai/agent/session-briefing.test.ts` (add render tests)
- Modify: `lib/ai/agent/audit-agent.ts` (replace lines 136–163)
- Modify: `lib/db/capture-messages-queries.ts` (remove now-dead fields)
- Modify: `tests/lib/ai/agent/audit-agent.test.ts` (integration assertion)

- [ ] **Step 1: Write the failing `renderBriefing` tests**

Append to `tests/lib/ai/agent/session-briefing.test.ts`:

```ts
import { renderBriefing } from '@/lib/ai/agent/session-briefing';

describe('renderBriefing', () => {
  it('returns the first-session sentinel for an empty array', () => {
    expect(renderBriefing([])).toBe('(none — this is the first audit session for this course)');
  });

  it('renders readiness, carried findings with citations, and the faculty line', () => {
    const out = renderBriefing([{
      sessionId: '4f3a1b2c-dddd-eeee-ffff-000000000000',
      startedAt: new Date('2026-05-30T00:00:00Z'),
      turnCount: 12,
      readiness: { score: 70, covered: ['outcomes', 'projects'], remaining: ['prereqs'] },
      stickyFindings: [
        { text: 'GC 3450 projects reach D=3 on layout.', citations: [{ type: 'chunk', chunkId: '8a1f0c11-aaaa', excerpt: 'x' }] },
        { text: 'No structured post-mortem; crits are informal.', citations: [{ type: 'instructor', messageId: '22b9ee01-bbbb', excerpt: 'y' }] },
      ],
      lastFacultyTurn: 'We do informal crits, no post-mortem.',
    }]);
    expect(out).toContain('Session 4f3a1b2c… · 2026-05-30 · 12 turns');
    expect(out).toContain('Readiness: 70% · covered: outcomes, projects · remaining: prereqs');
    expect(out).toContain('• "GC 3450 projects reach D=3 on layout." [cites: chunk 8a1f0c11]');
    expect(out).toContain('• "No structured post-mortem; crits are informal." [cites: msg 22b9ee01]');
    expect(out).toContain('Faculty last said: "We do informal crits, no post-mortem."');
  });

  it('handles missing readiness score and no findings/faculty gracefully', () => {
    const out = renderBriefing([{
      sessionId: 'abcd1234-0000', startedAt: new Date('2026-05-01T00:00:00Z'), turnCount: 1,
      readiness: { score: null, covered: [], remaining: [] }, stickyFindings: [], lastFacultyTurn: null,
    }]);
    expect(out).toContain('Readiness: ?% · covered: (none) · remaining: (none)');
    expect(out).toContain('Findings carried forward: (none recorded)');
    expect(out).not.toContain('Faculty last said');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run tests/lib/ai/agent/session-briefing.test.ts`
Expected: FAIL — `renderBriefing is not a function`.

- [ ] **Step 3: Implement `renderBriefing`**

Append to `lib/ai/agent/session-briefing.ts`:

```ts
function renderCitations(citations: CaptureMessageCitation[]): string {
  if (!citations.length) return '';
  const parts = citations
    .map(c => {
      if (c.chunkId) return `chunk ${c.chunkId.slice(0, 8)}`;
      if (c.messageId) return `msg ${c.messageId.slice(0, 8)}`;
      return null;
    })
    .filter((p): p is string => p !== null);
  return parts.length ? `[cites: ${parts.join(', ')}]` : '';
}

export function renderBriefing(briefings: SessionBriefing[]): string {
  if (briefings.length === 0) {
    return '(none — this is the first audit session for this course)';
  }
  return briefings
    .map(b => {
      const r = b.readiness;
      const readinessLine =
        `Readiness: ${r.score ?? '?'}% · covered: ${r.covered.join(', ') || '(none)'} · remaining: ${r.remaining.join(', ') || '(none)'}`;
      const findingsBlock = b.stickyFindings.length
        ? [
            'Findings carried forward (your prior turns, verbatim):',
            ...b.stickyFindings.map(f => {
              const cites = renderCitations(f.citations);
              return `  • "${f.text}"${cites ? ` ${cites}` : ''}`;
            }),
          ].join('\n')
        : 'Findings carried forward: (none recorded)';
      const facultyLine = b.lastFacultyTurn ? `Faculty last said: "${b.lastFacultyTurn}"` : '';
      return [
        `--- Session ${b.sessionId.slice(0, 8)}… · ${b.startedAt.toISOString().slice(0, 10)} · ${b.turnCount} turns ---`,
        readinessLine,
        findingsBlock,
        facultyLine,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}
```

- [ ] **Step 4: Run to verify the pure tests pass**

Run: `pnpm exec vitest run tests/lib/ai/agent/session-briefing.test.ts`
Expected: PASS — all `parseAssistantContent`, `composeSessionBriefing`, `renderBriefing` describes green.

- [ ] **Step 5: Wire into `buildAgentCall`**

In `lib/ai/agent/audit-agent.ts`, add to the imports near the top (next to the other `@/lib/ai/agent` / db imports):

```ts
import { composeSessionBriefing, renderBriefing } from '@/lib/ai/agent/session-briefing';
```

Replace the entire `const priorSessionsBlock = priorSessions.length ? ... : '(none ...)';` expression (lines 136–163) with:

```ts
  const priorSessionsBlock = renderBriefing(composeSessionBriefing(priorSessions));
```

(The `# Prior audit sessions (most recent)` heading at line 168, the `wantPriorSessions` gate, and the 3-session `listPriorSessionSummaries(courseCode, sessionId, 3)` limit are unchanged.)

- [ ] **Step 6: Remove the now-dead `PriorSessionSummary` fields**

In `lib/db/capture-messages-queries.ts`, now that `audit-agent.ts` no longer reads `recentTurns` / `lastAssistantContent` / `lastAssistantReadiness`, simplify. Replace the `PriorSessionSummary` interface with:

```ts
export interface PriorSessionSummary {
  sessionId: string;
  startedAt: Date;
  turnCount: number;
  /** Parsed assistant turns in chronological order (turnIndex asc). Drives the structured session briefing. */
  assistantTurns: ParsedAssistantTurn[];
  /** The most recent faculty (user) message body for this session, raw. null if the session has no faculty turns. */
  lastFacultyTurn: string | null;
}
```

In `listPriorSessionSummaries`, delete the now-unused locals (`lastAssistant`, `readiness`, `assistantText`, `recentTurns`, the `RECENT_TURNS_CAP`/`PER_TURN_CHAR_CAP` constants and the `tail`/`conversational`/`recentTurns` block) and reduce the `summaries.push` to:

```ts
    summaries.push({
      sessionId,
      startedAt: sessionRows[0]!.createdAt,
      turnCount: sessionRows.length,
      assistantTurns,
      lastFacultyTurn,
    });
```

Keep the early `if (!lastAssistant) continue;` behavior by replacing it with: `if (assistantTurns.length === 0) continue;` (skip sessions with no parseable assistant turns — matches prior behavior).

- [ ] **Step 7: Add the integration assertion**

In `tests/lib/ai/agent/audit-agent.test.ts`, add `buildAgentCall` to the import on line 74:

```ts
import { runAuditAgent, buildAgentCall } from '@/lib/ai/agent/audit-agent';
```

Add this test inside the existing top-level `describe` (after the helpers):

```ts
it('at-rest context uses the structured briefing, not the raw turn dump', async () => {
  mockGetCourseByCode.mockResolvedValue(makeCourse());
  mockListMaterialsByCourse.mockResolvedValue([makeMaterial()]);
  mockGetSessionMessages.mockResolvedValue([]); // opening turn (no history)
  mockListPriorSessionSummaries.mockResolvedValue([
    {
      sessionId: '4f3a1b2c-dddd-eeee-ffff-000000000000',
      startedAt: new Date('2026-05-30T00:00:00Z'),
      turnCount: 12,
      assistantTurns: [
        { finding: 'Older finding.', citations: [], readiness: { score: 40, covered: ['outcomes'], remaining: ['rubrics'] } },
        {
          finding: 'GC 3450 projects reach D=3 on layout.',
          citations: [{ type: 'chunk', chunkId: '8a1f0c11-aaaa-bbbb', excerpt: 'x' }],
          readiness: { score: 70, covered: ['outcomes', 'projects'], remaining: ['prereqs'] },
        },
      ],
      lastFacultyTurn: 'We do informal crits, no post-mortem.',
    },
  ]);

  const built = await buildAgentCall({ sessionId: 'new-session', courseCode: 'GC 4800', auditMode: 'full' });
  const atRest = built.messages[0]!.content as string;

  expect(atRest).toContain('Readiness: 70% · covered: outcomes, projects · remaining: prereqs');
  expect(atRest).toContain('GC 3450 projects reach D=3 on layout.');
  expect(atRest).toContain('[cites: chunk 8a1f0c11]');
  expect(atRest).toContain('Faculty last said: "We do informal crits, no post-mortem."');
  expect(atRest).not.toContain('Recent turns (chronological');
});
```

- [ ] **Step 8: Run the affected tests + typecheck**

Run: `pnpm exec vitest run tests/lib/ai/agent/session-briefing.test.ts tests/lib/ai/agent/audit-agent.test.ts`
Expected: PASS — both files green, including the new integration test.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/ai/agent/session-briefing.ts lib/ai/agent/audit-agent.ts lib/db/capture-messages-queries.ts tests/lib/ai/agent/session-briefing.test.ts tests/lib/ai/agent/audit-agent.test.ts
git commit -m "feat(capture): render structured briefing into at-rest context; drop raw turn dump"
```

---

## Task 5: Faculty "Where we left off" recap card

**Files:**
- Modify: `app/capture/[code]/CaptureChatPanel.tsx` (define+export `SessionBriefingView`, accept prop, render card)
- Modify: `app/capture/[code]/CaptureClient.tsx` (thread prop)
- Modify: `app/capture/[code]/page.tsx` (compute + serialize briefings)

> This task is UI glue with no pure-logic seam, so it is verified by typecheck + a manual smoke rather than a unit test (consistent with the spec's testing section: nothing here is model-generated or branching logic worth a unit test).

- [ ] **Step 1: Define the serializable view type + prop in `CaptureChatPanel.tsx`**

Near the top of `app/capture/[code]/CaptureChatPanel.tsx` (with the other exported types), add:

```ts
export interface SessionBriefingView {
  sessionId: string;
  startedAt: string; // ISO — Date is not passed across the RSC boundary here
  turnCount: number;
  readiness: { score: number | null; covered: string[]; remaining: string[] };
  stickyFindings: Array<{ text: string }>;
  lastFacultyTurn: string | null;
}
```

Add to the `Props` interface (after `initialInstructor`):

```ts
  /** Distilled recap of prior sessions for the "Where we left off" card. Empty/omitted hides the card. */
  priorBriefings?: SessionBriefingView[];
```

Add `priorBriefings` to the destructured params of `CaptureChatPanel({ ... })`.

- [ ] **Step 2: Render the collapsed recap card**

Inside `CaptureChatPanel`, immediately before the transcript container (the `<div ref={transcriptRef} ...>`), insert:

```tsx
{priorBriefings && priorBriefings.length > 0 && (
  <details className="mb-3 rounded border border-stone-200 bg-stone-50 text-sm">
    <summary className="cursor-pointer select-none px-3 py-2 font-medium text-stone-700">
      Where we left off · {priorBriefings.length} prior session{priorBriefings.length > 1 ? 's' : ''}
    </summary>
    <div className="space-y-3 px-3 pb-3">
      {priorBriefings.map(b => (
        <div key={b.sessionId} className="border-t border-stone-200 pt-2 first:border-t-0 first:pt-0">
          <div className="text-xs text-stone-500">
            {b.startedAt.slice(0, 10)} · {b.turnCount} turns · readiness {b.readiness.score ?? '?'}%
          </div>
          {(b.readiness.covered.length > 0 || b.readiness.remaining.length > 0) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {b.readiness.covered.map(c => (
                <span key={`c-${c}`} className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">{c}</span>
              ))}
              {b.readiness.remaining.map(c => (
                <span key={`r-${c}`} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{c}</span>
              ))}
            </div>
          )}
          {b.stickyFindings.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-stone-700">
              {b.stickyFindings.map((f, i) => (
                <li key={i}>{f.text}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  </details>
)}
```

- [ ] **Step 3: Thread the prop through `CaptureClient.tsx`**

In `app/capture/[code]/CaptureClient.tsx`, add `priorBriefings` to the component's props interface (find the `interface` / props type for `CaptureClient` and add `priorBriefings?: SessionBriefingView[];`, importing the type: `import { CaptureChatPanel, type ChatMessage, type SessionBriefingView } from './CaptureChatPanel';`). Then pass it on the `<CaptureChatPanel>` mount (after `initialInstructor={initialInstructor}` at line 273):

```tsx
            priorBriefings={priorBriefings}
```

Ensure `priorBriefings` is destructured from `CaptureClient`'s props.

- [ ] **Step 4: Compute + serialize in `page.tsx`**

In `app/capture/[code]/page.tsx`, extend the existing import from the query module (line 10) to include `listPriorSessionSummaries`, and add the briefing imports:

```ts
import { getLatestSessionId, getSessionInstructor, listPriorSessionSummaries } from '@/lib/db/capture-messages-queries';
import { composeSessionBriefing } from '@/lib/ai/agent/session-briefing';
import type { SessionBriefingView } from './CaptureChatPanel';
```

After `currentSessionId` is resolved (line 64), add:

```ts
  // Distilled recap of prior sessions (excludes the in-flight one). Serializable
  // view: Date -> ISO string, citations dropped (not surfaced in the card).
  const priorSummaries = await listPriorSessionSummaries(code, currentSessionId ?? '', 3);
  const priorBriefings: SessionBriefingView[] = composeSessionBriefing(priorSummaries).map(b => ({
    sessionId: b.sessionId,
    startedAt: b.startedAt.toISOString(),
    turnCount: b.turnCount,
    readiness: b.readiness,
    stickyFindings: b.stickyFindings.map(f => ({ text: f.text })),
    lastFacultyTurn: b.lastFacultyTurn,
  }));
```

Pass `priorBriefings={priorBriefings}` to the `<CaptureClient ... />` element rendered by this page (find the existing `<CaptureClient` JSX and add the prop).

- [ ] **Step 5: Typecheck + manual smoke**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Manual smoke (the dev server is already running per STATE.md's watchdog; if not, `pnpm dev:lan`):
- Open `/capture/<a course with ≥1 prior session>?slug=<PROTOTYPE_SLUG>`.
- Confirm a collapsed "Where we left off · N prior session(s)" card appears above the chat; expanding it shows date/turns/readiness chips + carried findings.
- Open `/capture/<a course with no prior sessions>` and confirm the card is absent.

- [ ] **Step 6: Commit**

```bash
git add app/capture/[code]/CaptureChatPanel.tsx app/capture/[code]/CaptureClient.tsx app/capture/[code]/page.tsx
git commit -m "feat(capture): 'Where we left off' recap card from session briefing"
```

---

## Task 6: Full suite, STATE.md, close-out

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS — full suite green (baseline was 632/632; this adds the `session-briefing` file + one `audit-agent` test). Investigate any failure before proceeding.

- [ ] **Step 2: Update STATE.md**

In `docs/STATE.md`, update the CourseCapture v2 row in "Next-up → Spec'd, not yet implemented": change the session-continuity briefing clause from "spec'd … plan pending" to shipped. Replace:

```
Stage 7 remainder: **session-continuity briefing now spec'd** ([design](./superpowers/specs/2026-06-04-session-continuity-briefing-design.md), 2026-06-04 — deterministic structured briefing replacing the raw-transcript dump; no new AI call, no migration; plan pending). Faculty profiles still unspec'd. |
```

with:

```
Stage 7 remainder: **session-continuity briefing shipped 2026-06-04** ([design](./superpowers/specs/2026-06-04-session-continuity-briefing-design.md) · [plan](./superpowers/plans/2026-06-04-session-continuity-briefing.md)) — deterministic structured briefing (`lib/ai/agent/session-briefing.ts`) replaced the raw-transcript dump in the audit agent's at-rest context + a "Where we left off" recap card; no new AI call, no migration. Faculty profiles still unspec'd. |
```

Also add a one-line entry to the "What's live → Cross-cutting" table or the Active arc CourseCapture v2 paragraph noting the briefing shipped (match the surrounding style; reference `session-briefing.ts` and the recap card). Bump the `Last verified` line to `git rev-parse --short HEAD` + 2026-06-04.

- [ ] **Step 3: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): session-continuity briefing shipped (CourseCapture v2 Stage 7)"
```

---

## Self-Review

**1. Spec coverage:**
- Deterministic, verbatim, no LLM → Tasks 1–4 (all parsing/compose/render is pure string ops). ✓
- `SessionBriefing` shape (readiness / stickyFindings last 2–3 distinct / lastFacultyTurn) → Task 2. ✓
- Composition rule (newest-first, distinct, caps, defensive readiness) → Task 2 tests + impl. ✓
- Replace `priorSessionsBlock` (audit-agent.ts:136–163) → Task 4 Step 5. ✓
- Bounded / token-regression (no per-turn 1500-char fan-out) → guaranteed by removing `recentTurns` (Task 4 Step 6) + the integration test asserting the dump string is absent. ✓
- Faculty "Where we left off" card → Task 5. ✓
- Edge cases: no prior sessions (render sentinel — render test + composer `[]`), no assistant turns (query `continue`), non-JSON content (parser test), missing readiness (composer test), fresh-start `includePriorSessions:false` (unchanged upstream gate — untouched in Task 4). ✓
- No migration / no new AI function → confirmed (no schema or `AI_FUNCTION_IDS` changes anywhere). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; every run step states the exact command + expected result. ✓

**3. Type consistency:** `ParsedAssistantTurn` (finding/citations/readiness) defined in Task 1, consumed by query (Task 3) and composer (Task 2). `StoredReadiness` (score:number|null) used uniformly by parser, composer, render, and `SessionBriefingView`. `SessionBriefing.readiness` is `StoredReadiness`; the `SessionBriefingView.readiness` mirror is structurally identical. `composeSessionBriefing` / `renderBriefing` / `parseAssistantContent` names match across tasks. `buildAgentCall` return `.messages` matches the confirmed signature `{ systemPrompt, messages, tools, isOpeningTurn, userTurnIndex }`. ✓

**One watch-item for the implementer:** the `import type`-only edge from `session-briefing.ts` → `capture-messages-queries.ts` is load-bearing for avoiding a runtime cycle. If `tsc`/vitest reports a cycle or `undefined` at import, confirm `session-briefing.ts` has **no** value import from the query module or `@/lib/db/client`.
