import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  WIKI_PAGE_TYPES, HAND_AUTHORED_TYPES, WIKI_SERVED_TYPES, WIKI_SERVED_SCHEMA,
} from '@/lib/ai/wiki/schema';

describe('wiki served types', () => {
  it('serves the generated sections plus the hand-authored research section', () => {
    expect([...WIKI_SERVED_TYPES]).toEqual([...WIKI_PAGE_TYPES, ...HAND_AUTHORED_TYPES]);
    expect(HAND_AUTHORED_TYPES).toEqual(['research']);
    expect(WIKI_PAGE_TYPES).not.toContain('research');
    expect(WIKI_SERVED_SCHEMA.research).toEqual({ dir: 'research', requiredSections: [] });
    expect(WIKI_SERVED_SCHEMA.courses.requiredSections).toEqual(['Competencies developed', 'Source snapshots']);
  });

  it('no module re-declares the four-section list outside schema.ts', async () => {
    const roots = ['lib', 'app', 'scripts'];
    const re = /\[\s*'courses',\s*'competencies',\s*'targets',\s*'concepts'\s*\]/;
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '__tests__') continue;
          await walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name) && !p.endsWith(path.join('lib', 'ai', 'wiki', 'schema.ts'))) {
          if (re.test(await fs.readFile(p, 'utf8'))) offenders.push(p);
        }
      }
    }
    for (const r of roots) await walk(r);
    expect(offenders).toEqual([]);
  });
});
