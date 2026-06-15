import { describe, it, expect } from 'vitest';
import { isProgramVisible, isSandbox, isProposed } from '@/lib/courses/program-visibility';

const C = (scope: string, status: string) => ({ scope, status }) as { scope: 'gc' | 'external'; status: 'offered' | 'proposed' | 'sandbox' | 'retired' };

describe('program-visibility predicates', () => {
  it('isProgramVisible only for gc + offered', () => {
    expect(isProgramVisible(C('gc', 'offered'))).toBe(true);
    expect(isProgramVisible(C('gc', 'proposed'))).toBe(false);
    expect(isProgramVisible(C('gc', 'retired'))).toBe(false);
    expect(isProgramVisible(C('external', 'sandbox'))).toBe(false);
    expect(isProgramVisible(C('external', 'offered'))).toBe(false);
  });
  it('isSandbox only for external + sandbox', () => {
    expect(isSandbox(C('external', 'sandbox'))).toBe(true);
    expect(isSandbox(C('gc', 'offered'))).toBe(false);
  });
  it('isProposed only for status proposed (any scope)', () => {
    expect(isProposed(C('gc', 'proposed'))).toBe(true);
    expect(isProposed(C('gc', 'offered'))).toBe(false);
  });
});
