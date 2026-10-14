/**
 * sync-research (spec 2026-10-14) against real git in temp dirs: a bare
 * remote, a clone used as the wiki, and a separate source dir. Never touches
 * the live wiki repo.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Pass-through by default; one test injects a staged outside change right
// after the sync's pull (i.e. after its dirty check) to prove the pathspec.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

import { syncResearch, readResearchSource, ResearchSyncRefusal } from '@/lib/wiki/research-sync';

let tmp: string; let wiki: string; let src: string;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const TS = async () => '2026-10-14T12:00:00Z';
const BASE = 'https://example.test';
const page = (slug: string, extra = '', body = `# ${slug}\n\nText.\n`) =>
  `---\ntype: research\ntitle: "${slug}"\ndescription: "about ${slug}"\nslug: ${slug}\ntags: [research]\n${extra}---\n${body}`;

async function w(dir: string, rel: string, body: string) {
  const abs = path.join(dir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body);
}
const OKF_T = (slug: string) => `---\ntype: target\ntitle: "${slug}"\ndescription: "d"\nslug: ${slug}\ntags: [target]\ntimestamp: 2026-10-01T00:00:00Z\nresource: ${BASE}/wiki/targets/${slug}\n---\n# ${slug}\n## Sub-competencies\n- x\n## Program-level rollup\nx\n`;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'research-sync-'));
  const remote = path.join(tmp, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  wiki = path.join(tmp, 'wiki');
  execFileSync('git', ['clone', '-q', remote, wiki], { stdio: 'ignore' });
  git(wiki, 'config', 'user.email', 't@example.test'); git(wiki, 'config', 'user.name', 'test');
  git(wiki, 'checkout', '-q', '-b', 'main');
  await w(wiki, 'targets/brand-strategy.md', OKF_T('brand-strategy'));
  git(wiki, 'add', '-A'); git(wiki, 'commit', '-qm', 'seed'); git(wiki, 'push', '-q', 'origin', 'main');
  src = path.join(tmp, 'src');
  await w(src, 'ai-careers-brief.md', page('ai-careers-brief', '', '# Brief\n\nSee [[career-paths]] and [[brand-strategy]].\n'));
  await w(src, 'career-paths.md', page('career-paths', '', '# Career paths\n\n[[ai-careers-brief]]\n'));
  await w(src, 'SOURCES.md', '# reviewer notes — never synced\n');
});
afterEach(async () => {
  vi.mocked(childProcess.execFile).mockClear();
  await fs.rm(tmp, { recursive: true, force: true });
});

const run = (apply: boolean) => syncResearch({ sourceDir: src, wikiRoot: wiki, apply, base: BASE, timestampOf: TS });

describe('readResearchSource', () => {
  it('stamps resource + timestamp, skips SOURCES.md', async () => {
    const pages = await readResearchSource(src, { base: BASE, timestampOf: TS });
    expect(pages.map(p => p.file).sort()).toEqual(['ai-careers-brief.md', 'career-paths.md']);
    const brief = pages.find(p => p.slug === 'ai-careers-brief')!;
    expect(brief.content).toContain(`resource: ${BASE}/wiki/research/ai-careers-brief`);
    expect(brief.content).toContain('timestamp: 2026-10-14T12:00:00Z');
  });
  it.each([
    ['wrong type', page('x').replace('type: research', 'type: concept'), 'x.md'],
    ['slug mismatch', page('other'), 'x.md'],
    ['email in body', page('x', '', 'mail me at someone@example.edu\n'), 'x.md'],
    ['bad filename', page('X_Y'), 'X_Y.md'],
  ])('refuses: %s', async (_label, body, file) => {
    await fs.rm(src, { recursive: true, force: true });
    await w(src, file, body);
    await expect(readResearchSource(src, { base: BASE, timestampOf: TS })).rejects.toBeInstanceOf(ResearchSyncRefusal);
  });
});

describe('syncResearch', () => {
  it('dry run writes nothing', async () => {
    const r = await run(false);
    expect(r.applied).toBe(false);
    expect(r.plan.write.sort()).toEqual(['ai-careers-brief.md', 'career-paths.md']);
    await expect(fs.stat(path.join(wiki, 'research'))).rejects.toThrow();
    expect(git(wiki, 'status', '--porcelain')).toBe('');
  });

  it('apply copies, commits only research/, pushes; a stray untracked file is untouched', async () => {
    await w(wiki, 'courses/stray.md', 'untracked\n');
    const r = await run(true);
    expect(r.applied).toBe(true);
    expect(r.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(wiki, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['research/ai-careers-brief.md', 'research/career-paths.md']);
    expect(git(wiki, 'status', '--porcelain', '--untracked-files=all')).toBe('?? courses/stray.md');
    expect(git(wiki, 'rev-parse', 'HEAD')).toBe(git(wiki, 'rev-parse', 'origin/main'));
  });

  it('a second run with unchanged source makes no commit', async () => {
    await run(true);
    const head = git(wiki, 'rev-parse', 'HEAD');
    const r = await run(true);
    expect(r.plan.write).toEqual([]);
    expect(r.sha).toBe(null);
    expect(git(wiki, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('removes research/*.md no longer in the source, and nothing outside research/', async () => {
    await run(true);
    await fs.rm(path.join(src, 'career-paths.md'));
    await w(src, 'ai-careers-brief.md', page('ai-careers-brief', '', '# Brief\n\n[[brand-strategy]]\n'));
    const r = await run(true);
    expect(r.plan.remove).toEqual(['career-paths.md']);
    expect(await fs.readdir(path.join(wiki, 'research'))).toEqual(['ai-careers-brief.md']);
    expect(await fs.readFile(path.join(wiki, 'targets', 'brand-strategy.md'), 'utf8')).toBe(OKF_T('brand-strategy'));
  });

  it('refuses when tracked files outside research/ are modified, and writes nothing', async () => {
    await fs.appendFile(path.join(wiki, 'targets', 'brand-strategy.md'), 'edit\n');
    await expect(run(true)).rejects.toBeInstanceOf(ResearchSyncRefusal);
    await expect(fs.stat(path.join(wiki, 'research'))).rejects.toThrow();
  });

  it('a lint error in research/ refuses and restores research/ to HEAD', async () => {
    await run(true);
    const before = git(wiki, 'rev-parse', 'HEAD');
    await w(src, 'career-paths.md', page('career-paths', '', '# Career paths\n\n[[no-such-page]]\n'));
    await expect(run(true)).rejects.toBeInstanceOf(ResearchSyncRefusal);
    expect(git(wiki, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(wiki, 'status', '--porcelain')).toBe('');
  });

  it('refuses when <wiki>/research is a symlink', async () => {
    const elsewhere = path.join(tmp, 'elsewhere'); await fs.mkdir(elsewhere);
    await fs.symlink(elsewhere, path.join(wiki, 'research'));
    await expect(run(true)).rejects.toBeInstanceOf(ResearchSyncRefusal);
    expect(await fs.readdir(elsewhere)).toEqual([]);
  });

  it('refuses when the source dir is inside the wiki repo', async () => {
    await expect(syncResearch({ sourceDir: path.join(wiki, 'targets'), wikiRoot: wiki, apply: false, base: BASE, timestampOf: TS }))
      .rejects.toBeInstanceOf(ResearchSyncRefusal);
  });

  // --- scope-invariant regressions beyond the brief ---

  it('a staged outside change that appears after the dirty check never enters the commit', async () => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    vi.mocked(childProcess.execFile).mockImplementation(((file: string, args: string[], cb: (...a: unknown[]) => void) =>
      actual.execFile(file, args, (err, stdout, stderr) => {
        if (!err && args.includes('pull')) {
          // Another writer stages a tracked change outside research/ mid-sync.
          execFileSync('sh', ['-c', `printf 'other writer\\n' >> "${path.join(wiki, 'targets', 'brand-strategy.md')}"`]);
          git(wiki, 'add', 'targets/brand-strategy.md');
        }
        cb(err, stdout, stderr);
      })) as unknown as typeof childProcess.execFile);
    try {
      const r = await run(true);
      expect(r.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(git(wiki, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort())
        .toEqual(['research/ai-careers-brief.md', 'research/career-paths.md']);
      expect(git(wiki, 'status', '--porcelain')).toBe('M  targets/brand-strategy.md'); // still staged, not committed
    } finally {
      vi.mocked(childProcess.execFile).mockImplementation(actual.execFile as unknown as typeof childProcess.execFile);
    }
  });

  it('refuses when a file inside research/ is a symlink (no write through it)', async () => {
    await run(true);
    const target = path.join(wiki, 'targets', 'brand-strategy.md');
    await fs.rm(path.join(wiki, 'research', 'career-paths.md'));
    await fs.symlink(target, path.join(wiki, 'research', 'career-paths.md'));
    await w(src, 'career-paths.md', page('career-paths', '', '# Career paths changed\n\n[[ai-careers-brief]]\n'));
    await expect(run(true)).rejects.toBeInstanceOf(ResearchSyncRefusal);
    expect(await fs.readFile(target, 'utf8')).toBe(OKF_T('brand-strategy'));
  });

  it('refuses when the clone has unpushed commits touching paths outside research/', async () => {
    await w(wiki, 'targets/brand-strategy.md', OKF_T('brand-strategy') + 'local only\n');
    git(wiki, 'commit', '-qam', 'unpushed outside change');
    const remoteBefore = git(wiki, 'rev-parse', 'origin/main');
    await expect(run(true)).rejects.toBeInstanceOf(ResearchSyncRefusal);
    await expect(fs.stat(path.join(wiki, 'research'))).rejects.toThrow();
    expect(git(path.join(tmp, 'remote.git'), 'rev-parse', 'main')).toBe(remoteBefore);
  });

  it('a rerun pushes an earlier sync commit whose push failed', async () => {
    // Simulate a sync that committed research/ but whose push failed.
    const pages = await readResearchSource(src, { base: BASE, timestampOf: TS });
    for (const p of pages) await w(wiki, `research/${p.file}`, p.content);
    git(wiki, 'add', '-A', '--', 'research'); git(wiki, 'commit', '-qm', 'research: sync (push failed)');
    const local = git(wiki, 'rev-parse', 'HEAD');
    const r = await run(true);
    expect(r.plan.write).toEqual([]);
    expect(r.sha).toBe(local);
    expect(git(path.join(tmp, 'remote.git'), 'rev-parse', 'main')).toBe(local);
  });

  it('refuses when the wiki path is not the top level of a git repo', async () => {
    // Lint-clean source (no link to a page outside research/), so only the
    // top-level guard stands between this run and a commit of targets/research/.
    await w(src, 'ai-careers-brief.md', page('ai-careers-brief', '', '# Brief\n\n[[career-paths]]\n'));
    await expect(syncResearch({ sourceDir: src, wikiRoot: path.join(wiki, 'targets'), apply: true, base: BASE, timestampOf: TS }))
      .rejects.toBeInstanceOf(ResearchSyncRefusal);
    await expect(fs.stat(path.join(wiki, 'targets', 'research'))).rejects.toThrow();
    expect(git(wiki, 'status', '--porcelain')).toBe('');
  });
});
