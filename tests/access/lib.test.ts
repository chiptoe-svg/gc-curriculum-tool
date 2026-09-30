import { describe, it, expect } from 'vitest';
import { parseGrantArgs, checkCourses } from '@/scripts/access/lib';

const now = new Date('2026-09-30T12:00:00Z');
describe('parseGrantArgs', () => {
  it('parses a course grant with days', () => {
    expect(parseGrantArgs(['Danita Swaney', '--courses', 'GC 3730', '--can', 'capture', '--days', '30'], now))
      .toEqual({ label: 'Danita Swaney', scope: ['GC 3730'], can: ['capture'], expiresAt: new Date('2026-10-30T12:00:00Z') });
  });
  it('splits and normalises multiple courses and capabilities', () => {
    const a = parseGrantArgs(['x', '--courses', 'gc 1020, GC%201050', '--can', 'capture,create', '--days', '1'], now);
    expect(a.scope).toEqual(['GC 1020', 'GC 1050']); expect(a.can).toEqual(['capture', 'create']);
  });
  it('--no-expiry sets null; missing both is an error', () => {
    expect(parseGrantArgs(['x', '--courses', '*', '--can', 'admin', '--no-expiry'], now).expiresAt).toBeNull();
    expect(() => parseGrantArgs(['x', '--courses', 'GC 3730', '--can', 'capture'], now)).toThrow(/--days or --no-expiry/);
  });
  it('admin requires *', () => {
    expect(() => parseGrantArgs(['x', '--courses', 'GC 3730', '--can', 'admin', '--days', '1'], now)).toThrow(/admin requires --courses '\*'/);
  });
  it('rejects unknown capabilities and empty label', () => {
    expect(() => parseGrantArgs(['x', '--courses', 'GC 3730', '--can', 'root', '--days', '1'], now)).toThrow(/unknown capability/);
    expect(() => parseGrantArgs(['', '--courses', 'GC 3730', '--can', 'capture', '--days', '1'], now)).toThrow(/label/);
  });
});
describe('checkCourses', () => {
  it('reports codes not in the roster, ignores *', () => {
    expect(checkCourses(['GC 3730', 'GC 9999'], ['GC 3730', 'GC 1010'])).toEqual(['GC 9999']);
    expect(checkCourses(['*'], [])).toEqual([]);
  });
});
