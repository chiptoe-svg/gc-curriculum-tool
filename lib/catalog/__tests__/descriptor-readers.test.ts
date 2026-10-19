import { describe, it, expect } from 'vitest';
import { cardEmbedText } from '../bundles';
import { buildCardUserMessage } from '@/lib/ai/catalog/draft-bundle-card';
import { buildTargetContext } from '@/lib/ai/analyze/target-context';

const foundational = { id: 'f', name: 'Agency', knowDescriptor: null, understandDescriptor: null, doDescriptor: 'Acts without prompting', origin: 'o' };
const full = { id: 'g', name: 'Color', knowDescriptor: 'K', understandDescriptor: 'U', doDescriptor: 'D', origin: 'o' };

describe('null-safe descriptor text paths', () => {
  it('cardEmbedText omits K/U for a D-only bundle and is unchanged for a full one', () => {
    const card = { stratum: 'foundational' as const, includes: 'i', excludes: 'e', distinctions: 'd', positiveExamples: ['p'], negativeExamples: ['n'] };
    const t = cardEmbedText(foundational, card);
    expect(t).not.toMatch(/null|undefined/);
    expect(t).toContain('Do only (foundational): Acts without prompting');
    expect(cardEmbedText(full, card)).toBe('Color\nKnow: K\nUnderstand: U\nDo: D\nIncludes: i\nExamples: p');
  });
  it('buildCardUserMessage keeps the bold format and omits null K/U; catalog JSON carries null, not "null"', () => {
    const m = buildCardUserMessage(foundational, [foundational, full]);
    expect(m).toContain('**Do only (foundational):** Acts without prompting');
    expect(m).not.toContain('**Know:**');
    expect(buildCardUserMessage(full, [full])).toContain('**Know:** K\n**Understand:** U\n**Do:** D');
  });
  it('buildTargetContext omits null K/U', () => {
    const ctx = buildTargetContext({ id: 't', name: 'T', shortDefinition: 's', industryContexts: [], knowDescriptors: [], understandDescriptors: [], doDescriptors: [], defensibilityNote: 'n', socCode: null, subCompetencies: [{ id: 'f', name: 'Agency', knowDescriptor: null, understandDescriptor: null, doDescriptor: 'X' }] } as never);
    expect(ctx).toContain('    Do only (foundational): X');
    expect(ctx).not.toMatch(/null|undefined|Know:/);
  });
});
