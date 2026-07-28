import { describe, it, expect } from 'vitest';
import { isDeckGeometry } from '@/lib/courses/pdf-classify';

describe('isDeckGeometry', () => {
  it('flags a 16:9 slide page (960x540pt)', () => {
    expect(isDeckGeometry(960, 540)).toBe(true);
  });
  it('flags a 1920x1080pt page', () => {
    expect(isDeckGeometry(1920, 1080)).toBe(true);
  });
  it('does NOT flag letter portrait (612x792pt)', () => {
    expect(isDeckGeometry(612, 792)).toBe(false);
  });
  it('does NOT flag A4 portrait (595x842pt)', () => {
    expect(isDeckGeometry(595, 842)).toBe(false);
  });
  it('flags an oversized page (long edge > 1500pt) regardless of aspect', () => {
    expect(isDeckGeometry(1700, 1300)).toBe(true);
  });
  it('returns false for zero/garbage dims', () => {
    expect(isDeckGeometry(0, 0)).toBe(false);
  });
});
