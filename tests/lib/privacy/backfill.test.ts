// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isRetiredPrivacyHold, listWikiFiles, scanWikiForIdentifiers } from '@/lib/privacy/backfill';

describe('isRetiredPrivacyHold', () => {
  it('matches the FERPA hold and the Discussions rule', () => {
    expect(isRetiredPrivacyHold({ autoSetAside: true, setAsideReason: 'FERPA risk detected (emails) — set aside automatically so student data is not sent to the AI provider. Review and override to include.' })).toBe(true);
    expect(isRetiredPrivacyHold({ autoSetAside: true, setAsideReason: 'Contains student posts' })).toBe(true);
  });
  it('leaves other set-asides and manual ignores alone', () => {
    expect(isRetiredPrivacyHold({ autoSetAside: true, setAsideReason: 'Empty or malformed import' })).toBe(false);
    expect(isRetiredPrivacyHold({ autoSetAside: true, setAsideReason: 'Filename looks like grades/roster data' })).toBe(false);
    expect(isRetiredPrivacyHold({ autoSetAside: false, setAsideReason: 'Contains student posts' })).toBe(false);
    expect(isRetiredPrivacyHold({ autoSetAside: true, setAsideReason: null })).toBe(false);
  });
});

describe('wiki scan', () => {
  let root = '';
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-scan-'));
    await fs.mkdir(path.join(root, 'courses'), { recursive: true });
    await fs.mkdir(path.join(root, 'raw/snapshots'), { recursive: true });
    await fs.mkdir(path.join(root, '.git'), { recursive: true });
    await fs.writeFile(path.join(root, 'courses/a.md'), 'Contact jane@g.clemson.edu or jane@g.clemson.edu');
    await fs.writeFile(path.join(root, 'raw/snapshots/s.json'), '{"id":"C12345678","x":"b@c.io"}');
    await fs.writeFile(path.join(root, 'courses/clean.md'), '# Clean');
    await fs.writeFile(path.join(root, '.git/leak.md'), 'x@y.io');
    await fs.writeFile(path.join(root, 'notes.txt'), 'x@y.io');
  });
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('lists .md and .json files, skipping .git and other extensions', async () => {
    expect(await listWikiFiles(root)).toEqual(['courses/a.md', 'courses/clean.md', 'raw/snapshots/s.json']);
  });

  it('reports files with distinct email/CUID hits', async () => {
    expect(await scanWikiForIdentifiers(root)).toEqual([
      { path: 'courses/a.md', hits: 1 },
      { path: 'raw/snapshots/s.json', hits: 2 },
    ]);
  });
});
