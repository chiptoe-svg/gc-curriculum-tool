import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evidenceFor, getEvidence, loadEvidence } from '@/lib/settings/evidence';
import { AI_FUNCTION_IDS } from '@/lib/ai/function-settings';
import { MODEL_ROLES } from '@/lib/ai/models';

function dir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'evidence-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
  return d;
}

const file = (title: string, date: string, applies: string, body = 'Body text.') =>
  `---\ntitle: ${title}\ndate: ${date}\napplies: ${applies}\nsummary: ${title} summary\n---\n\n${body}\n`;

describe('evidence register', () => {
  it('parses files newest first and skips bad ones', () => {
    const d = dir({
      'a-old.md': file('Old', '2026-10-05', 'role:judge'),
      'b-new.md': file('New', '2026-11-19', 'capture-chat-agent, role:converse'),
      'broken.md': 'no frontmatter here',
      'missing-date.md': '---\ntitle: X\napplies: role:write\nsummary: s\n---\nbody',
      'notes.txt': file('Ignored', '2026-11-19', 'role:write'),
    });
    const list = loadEvidence(d);
    expect(list.map(e => e.id)).toEqual(['b-new', 'a-old']);
    expect(list[0]).toMatchObject({ title: 'New', date: '2026-11-19', applies: ['capture-chat-agent', 'role:converse'], summary: 'New summary' });
    expect(list[0].body.trim()).toBe('Body text.');
  });

  it('looks up function first, then role; campus-routed functions skip the role', () => {
    const list = loadEvidence(dir({
      'fn.md': file('Fn', '2026-11-19', 'program-score-coverage'),
      'role.md': file('Role', '2026-10-05', 'role:judge'),
    }));
    expect(evidenceFor(list, 'program-score-coverage', 'judge', false)?.id).toBe('fn');
    expect(evidenceFor(list, 'capture-scores', 'judge', false)?.id).toBe('role');
    expect(evidenceFor(list, 'capture-scores', 'judge', true)).toBeNull();
    expect(evidenceFor(list, 'capture-scores', 'write', false)).toBeNull();
  });

  it('refuses path-like ids', () => {
    const d = dir({ 'fn.md': file('Fn', '2026-11-19', 'role:judge') });
    expect(getEvidence('fn', d)?.title).toBe('Fn');
    expect(getEvidence('../fn', d)).toBeNull();
    expect(getEvidence('nope', d)).toBeNull();
  });

  it('every applies key in docs/benchmarks names a known function, role or search setting', () => {
    const list = loadEvidence();
    expect(list.length).toBeGreaterThanOrEqual(8);
    const known = new Set<string>([...AI_FUNCTION_IDS, ...MODEL_ROLES.map(r => `role:${r}`), 'search:rerank', 'search:embedding']);
    for (const e of list) for (const key of e.applies) expect(known, `${e.id}: ${key}`).toContain(key);
  });
});
