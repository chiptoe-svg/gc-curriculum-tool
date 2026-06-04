import { describe, it, expect } from 'vitest';
import { parseAssistantContent, composeSessionBriefing, renderBriefing, type SessionBriefing } from '@/lib/ai/agent/session-briefing';
import type { PriorSessionSummary } from '@/lib/db/capture-messages-queries';

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

  it('separates multiple sessions with a blank line, preserving order', () => {
    const mk = (id: string, day: string): SessionBriefing => ({
      sessionId: id, startedAt: new Date(`2026-05-${day}T00:00:00Z`), turnCount: 3,
      readiness: { score: 50, covered: [], remaining: [] }, stickyFindings: [], lastFacultyTurn: null,
    });
    const out = renderBriefing([mk('aaaaaaaa-1111', '30'), mk('bbbbbbbb-2222', '28')]);
    expect(out).toContain('Session aaaaaaaa… · 2026-05-30');
    expect(out).toContain('Session bbbbbbbb… · 2026-05-28');
    // Two sessions joined by a blank line, in the order passed.
    expect(out.indexOf('aaaaaaaa…')).toBeLessThan(out.indexOf('bbbbbbbb…'));
    // Sessions are joined by a blank line, so splitting on \n\n yields one chunk per session.
    expect(out.split('\n\n')).toHaveLength(2);
  });
});
