/**
 * Pure write rules for skill strings. Each check returns null when the write is fine,
 * or the sentence shown to the user when it is not.
 */
import type { StringGraph } from './types';

export const MSG = {
  tooShort: 'A string needs at least two skills.',
  repeated: "A string can't visit the same skill twice.",
  unhooked: 'Every skill on a string needs a link to the next one.',
  mergeSelf: "A string can't merge into itself.",
  mergeUnlocked: 'That string is unlocked.',
  mergeCycle: 'That string already merges into this one.',
  mergeNoJoin: "The other string doesn't pass through this string's last skill.",
  branchAtEnd: 'Extend the string instead.',
  notFound: 'String not found.',
} as const;

/** At least two points, none repeated, and every consecutive pair linked. */
export function checkPath(g: StringGraph, path: string[]): string | null {
  if (path.length < 2) return MSG.tooShort;
  if (new Set(path).size !== path.length) return MSG.repeated;
  for (let i = 0; i < path.length - 1; i++) {
    if (!g.links.some((l) => l.from === path[i] && l.to === path[i + 1])) return MSG.unhooked;
  }
  return null;
}

/** `from` merges into `into`: `into` must be active, not already downstream of `from`, and pass through `from`'s last point. */
export function checkMerge(g: StringGraph, from: string, into: string): string | null {
  if (from === into) return MSG.mergeSelf;
  const a = g.strings.find((s) => s.id === from);
  const b = g.strings.find((s) => s.id === into);
  if (!a || !b) return MSG.notFound;
  if (b.status !== 'active') return MSG.mergeUnlocked;
  const seen = new Set<string>();
  for (let cur: string | null = b.mergedInto; cur && !seen.has(cur); ) {
    if (cur === from) return MSG.mergeCycle;
    seen.add(cur);
    cur = g.strings.find((s) => s.id === cur)?.mergedInto ?? null;
  }
  const last = a.path[a.path.length - 1];
  if (!last || !b.path.includes(last)) return MSG.mergeNoJoin;
  return null;
}

/** Branching after the last stop would just be extending. */
export function checkBranch(g: StringGraph, stringId: string, atPosition: number): string | null {
  const s = g.strings.find((x) => x.id === stringId);
  if (!s) return MSG.notFound;
  if (atPosition >= s.path.length - 1) return MSG.branchAtEnd;
  if (atPosition < 0) return MSG.branchAtEnd;
  return null;
}
