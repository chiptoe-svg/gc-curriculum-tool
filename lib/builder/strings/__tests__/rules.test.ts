import { describe, it, expect } from 'vitest';
import { checkPath, checkMerge, checkBranch } from '../rules';
import type { StringGraph, StringRow, LinkRow } from '../types';

const link = (from: string, to: string): LinkRow => ({ id: `${from}${to}`, from, to, why: 'w', createdBy: 't', createdAt: '' });
const str = (id: string, path: string[], over: Partial<StringRow> = {}): StringRow => ({
  id, name: id, description: '', status: 'active', endNote: null, mergedInto: null, version: 1, path, ...over,
});
const graph = (strings: StringRow[], links: LinkRow[] = []): StringGraph => ({ strings, points: {}, links, events: [] });

describe('checkPath', () => {
  const links = [link('a', 'b'), link('b', 'c')];
  it('accepts a linked path of two or more', () => {
    expect(checkPath(graph([], links), ['a', 'b', 'c'])).toBeNull();
    expect(checkPath(graph([], links), ['a', 'b'])).toBeNull();
  });
  it('refuses fewer than two points', () => {
    expect(checkPath(graph([], links), ['a'])).toBe('A string needs at least two skills.');
    expect(checkPath(graph([], links), [])).toBe('A string needs at least two skills.');
  });
  it('refuses a repeated point', () => {
    expect(checkPath(graph([], [...links, link('c', 'a')]), ['a', 'b', 'c', 'a'])).toBe("A string can't visit the same skill twice.");
  });
  it('refuses a pair with no link, and a link in the wrong direction', () => {
    expect(checkPath(graph([], links), ['a', 'c'])).toBe('Every skill on a string needs a link to the next one.');
    expect(checkPath(graph([], links), ['b', 'a'])).toBe('Every skill on a string needs a link to the next one.');
  });
});

describe('checkMerge', () => {
  const A = str('A', ['p1', 'p2']);
  const B = str('B', ['p0', 'p2', 'p3']);
  it('accepts when the other string passes through the last point', () => {
    expect(checkMerge(graph([A, B]), 'A', 'B')).toBeNull();
  });
  it('refuses itself', () => {
    expect(checkMerge(graph([A, B]), 'A', 'A')).toBe("A string can't merge into itself.");
  });
  it('refuses an unlocked target', () => {
    expect(checkMerge(graph([A, str('B', ['p2', 'p3'], { status: 'unlocked' })]), 'A', 'B')).toBe('That string is unlocked.');
  });
  it('refuses a cycle through the mergedInto chain', () => {
    const C = str('C', ['p2', 'p9'], { mergedInto: 'A' });
    const B2 = str('B', ['p2', 'p3'], { mergedInto: 'C' });
    expect(checkMerge(graph([A, B2, C]), 'A', 'B')).toBe('That string already merges into this one.');
  });
  it('terminates on a pre-existing loop elsewhere in the chain', () => {
    const X = str('X', ['p2'], { mergedInto: 'Y' });
    const Y = str('Y', ['p2'], { mergedInto: 'X' });
    const B2 = str('B', ['p2', 'p3'], { mergedInto: 'X' });
    expect(checkMerge(graph([A, B2, X, Y]), 'A', 'B')).toBeNull();
  });
  it("refuses when the last point isn't on the target", () => {
    expect(checkMerge(graph([A, str('B', ['p0', 'p3'])]), 'A', 'B')).toBe("The other string doesn't pass through this string's last skill.");
  });
});

describe('checkBranch', () => {
  const g = graph([str('A', ['p1', 'p2', 'p3'])]);
  it('accepts a branch before the last position', () => {
    expect(checkBranch(g, 'A', 0)).toBeNull();
    expect(checkBranch(g, 'A', 1)).toBeNull();
  });
  it('refuses at the last position', () => {
    expect(checkBranch(g, 'A', 2)).toBe('Extend the string instead.');
  });
});
