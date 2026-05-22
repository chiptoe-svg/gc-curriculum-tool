import { describe, it, expect } from 'vitest';
import { parseCanvasUrl } from '@/lib/canvas/parseCanvasUrl';

describe('parseCanvasUrl', () => {
  it('extracts course ID from standard URL', () => {
    expect(parseCanvasUrl('https://clemson.instructure.com/courses/12345')).toBe('12345');
  });

  it('extracts course ID when URL has trailing path', () => {
    expect(parseCanvasUrl('https://clemson.instructure.com/courses/12345/assignments')).toBe('12345');
  });

  it('returns null for URL without numeric course ID', () => {
    expect(parseCanvasUrl('https://clemson.instructure.com/courses/abc')).toBeNull();
  });

  it('returns null for non-URL strings', () => {
    expect(parseCanvasUrl('12345')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseCanvasUrl('')).toBeNull();
  });
});
