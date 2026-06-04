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
