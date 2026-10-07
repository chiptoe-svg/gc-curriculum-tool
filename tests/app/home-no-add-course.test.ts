// Owner, 2026-10-07: courses are added from the admin access page, not the
// public home page.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('home page', () => {
  it('has no "+ Add a course" button', () => {
    const src = readFileSync('app/page.tsx', 'utf8');
    expect(src).not.toMatch(/Add a course/);
    expect(src).not.toMatch(/\/courses\/new/);
  });
});
