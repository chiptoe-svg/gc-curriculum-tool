import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OrphanSkills } from '../OrphanSkills';

afterEach(cleanup);
const sk = (s: string) => ({ statement: s, hash: s, note: null });
const many = { developed: [sk('a'), sk('b')], unsupplied: [sk('c')] };
const one = { developed: [sk('a')], unsupplied: [] };

describe('OrphanSkills', () => {
  it('default look keeps the heading', () => {
    const { container } = render(<OrphanSkills courseCode="GC 1" orphans={many} onSaved={() => {}} />);
    expect(container.querySelector('h3')).not.toBeNull();
    expect(screen.getByText('Skills on no string')).toBeTruthy();
  });
  it('compact is a one-line plural note with no heading', () => {
    const { container } = render(<OrphanSkills compact courseCode="GC 1" orphans={many} onSaved={() => {}} />);
    expect(container.querySelector('h3')).toBeNull();
    expect(screen.getByText("3 skills here aren't on any string yet")).toBeTruthy();
    expect(container.querySelector('details')!.hasAttribute('open')).toBe(false);
  });
  it('compact uses the singular for one skill', () => {
    render(<OrphanSkills compact courseCode="GC 1" orphans={one} onSaved={() => {}} />);
    expect(screen.getByText("1 skill here isn't on any string yet")).toBeTruthy();
  });
});
