import { describe, it, expect } from 'vitest';
import { isUndefinedTable } from '@/lib/db/pg-errors';

describe('isUndefinedTable', () => {
  it('finds 42P01 on the error or in its cause chain', () => {
    expect(isUndefinedTable(Object.assign(new Error('x'), { code: '42P01' }))).toBe(true);
    expect(isUndefinedTable(new Error('Failed query', { cause: Object.assign(new Error('relation does not exist'), { code: '42P01' }) }))).toBe(true);
  });
  it('is false for any other failure', () => {
    expect(isUndefinedTable(Object.assign(new Error('x'), { code: '42703' }))).toBe(false);
    expect(isUndefinedTable(new Error('connection lost'))).toBe(false);
    expect(isUndefinedTable(null)).toBe(false);
  });
});
