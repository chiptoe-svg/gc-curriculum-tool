import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadWikiIndex, codeFromSlug, levelGroup, listFromFrontmatter } from '@/lib/wiki/index-data';

let root: string;
const fm = (o: Record<string, string>) =>
  '---\n' + Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n\n# body\n';

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'wiki-index-'));
  for (const d of ['courses', 'targets', 'competencies', 'concepts']) await mkdir(path.join(root, d));
  await writeFile(path.join(root, 'courses/gc-1010.md'), fm({ type: 'course', title: '"Orientation"', description: '"First-year."', level: '1', last_snapshot_path: 'raw/snapshots/gc-1010/2026-07-22_f78fa82.json', evidence_bands: '[claimed, materials_supported]' }));
  await writeFile(path.join(root, 'courses/gc-4900ap.md'), fm({ type: 'course', title: '"Capstone"', description: '"Senior."', level: '4', last_snapshot_path: 'raw/snapshots/gc-4900ap/2026-08-12_abc.json', evidence_bands: '[claimed]' }));
  await writeFile(path.join(root, 'courses/mkt-3310.md'), fm({ type: 'course', title: '"Marketing"', description: '"Outside GC."', level: '0' }));
  await writeFile(path.join(root, 'courses/index.md'), fm({ type: 'index', title: '"Courses"' }));
  await writeFile(path.join(root, 'targets/account-management.md'), fm({ type: 'target', title: '"Account Management"', description: '"Client-facing."' }));
  await writeFile(path.join(root, 'competencies/aesthetic-judgment.md'), fm({ type: 'competency', title: '"Aesthetic Judgment"', description: '"Visual decisions."' }));
  await writeFile(path.join(root, 'concepts/index.md'), fm({ type: 'index', title: '"Concepts"' }));
  await writeFile(path.join(root, 'concepts/productive-failure.md'), fm({ type: 'concept', title: '"Productive failure"', description: '"Generate then instruct."' }));
  await writeFile(path.join(root, 'log.md'), [
    '', '2026-08-12T20:46:11.392Z — ingest gc-4900ap: regenerated a', '',
    '2026-08-26T20:11:40.010Z — ingest gc-3710: regenerated b', '',
    '2026-08-26T20:11:40.010Z — ingest gc-3710: regenerated b', // duplicate line, must dedupe
    '2026-08-25T20:04:45.571Z — ingest gc-3730: regenerated c', '',
  ].join('\n'));
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('loadWikiIndex', () => {
  it('reads courses with code, level, last capture and evidence, skipping index pages', async () => {
    const d = await loadWikiIndex(root);
    expect(d.courses.map(c => c.code)).toEqual(['GC 1010', 'GC 4900AP', 'MKT 3310']);
    const c = d.courses[0]!;
    expect(c).toMatchObject({ slug: 'gc-1010', title: 'Orientation', level: 1, lastCaptured: '2026-07-22', materialsSupported: true });
    expect(d.courses[1]!.materialsSupported).toBe(false);
    expect(d.courses[2]).toMatchObject({ level: 0, lastCaptured: null });
  });
  it('lists targets, competencies and concepts by title, skipping the concepts index page', async () => {
    const d = await loadWikiIndex(root);
    expect(d.targets).toEqual([{ slug: 'account-management', title: 'Account Management', description: 'Client-facing.' }]);
    expect(d.competencies[0]!.title).toBe('Aesthetic Judgment');
    expect(d.concepts.map(c => c.slug)).toEqual(['productive-failure']);
  });
  it('returns recent log entries newest first, deduplicated', async () => {
    const d = await loadWikiIndex(root);
    expect(d.recent.map(r => r.text)).toEqual(['ingest gc-3710: regenerated b', 'ingest gc-3730: regenerated c', 'ingest gc-4900ap: regenerated a']);
  });
  it('tolerates a missing directory or log', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'wiki-empty-'));
    const d = await loadWikiIndex(empty);
    expect(d.courses).toEqual([]); expect(d.recent).toEqual([]);
    await rm(empty, { recursive: true, force: true });
  });
});
describe('helpers', () => {
  it('derives codes from slugs', () => {
    expect(codeFromSlug('gc-1010')).toBe('GC 1010');
    expect(codeFromSlug('gc-4900ap')).toBe('GC 4900AP');
    expect(codeFromSlug('mkt-3310')).toBe('MKT 3310');
  });
  it('maps levels to the 3-Act groups', () => {
    expect(levelGroup(1).key).toBe('foundations'); expect(levelGroup(2).key).toBe('foundations');
    expect(levelGroup(3).key).toBe('integration'); expect(levelGroup(4).key).toBe('specialty');
    expect(levelGroup(0).key).toBe('related');
  });
});

describe('listFromFrontmatter', () => {
  it('parses the raw "[a, b]" strings the frontmatter parser leaves', () => {
    expect(listFromFrontmatter('[gc-1040, gc-3460]')).toEqual(['gc-1040', 'gc-3460']);
    expect(listFromFrontmatter('[]')).toEqual([]);
    expect(listFromFrontmatter('null')).toEqual(['null']); // caller filters against known slugs
    expect(listFromFrontmatter(undefined)).toEqual([]);
    expect(listFromFrontmatter(['x'])).toEqual(['x']);
  });
});
