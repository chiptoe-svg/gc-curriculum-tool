import { describe, it, expect } from 'vitest';
import { formatDescriptorLines, isDoOnly } from '../descriptors';

describe('formatDescriptorLines', () => {
  it('emits Know/Understand/Do for a full competency', () => {
    expect(formatDescriptorLines({ knowDescriptor: 'K', understandDescriptor: 'U', doDescriptor: 'D' }))
      .toEqual(['Know: K', 'Understand: U', 'Do: D']);
  });
  it('marks a foundational competency "Do only" and never emits null/undefined', () => {
    const lines = formatDescriptorLines({ knowDescriptor: null, understandDescriptor: null, doDescriptor: 'D' });
    expect(lines).toEqual(['Do only (foundational): D']);
    expect(lines.join('\n')).not.toMatch(/null|undefined/);
  });
});

describe('isDoOnly', () => {
  it('is true only when both K and U are null', () => {
    expect(isDoOnly({ knowDescriptor: null, understandDescriptor: null })).toBe(true);
    expect(isDoOnly({ knowDescriptor: 'K', understandDescriptor: null })).toBe(false);
  });
});
