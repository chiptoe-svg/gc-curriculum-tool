/**
 * Sync the hand-authored research/ section into the wiki clone (spec
 * 2026-10-14). The second (and only other) wiki writer besides git-ops'
 * writeAndPush; it writes, deletes and commits ONLY under <wiki>/research/.
 *
 * Invariant: files outside research/ are never written, deleted or committed;
 * after a successful apply research/*.md equals the stamped source set and the
 * commit touches only research/; after a failed apply research/ equals HEAD.
 * (The one sanctioned exception is git itself fast-forwarding the clone to its
 * remote: `pull --ff-only` before writing, `pull --rebase` on a push retry.)
 *
 * Guards that keep writes inside research/:
 *   - <wiki> must be the top level of a git repo (else `git -C` would walk up
 *     to a parent repo and pathspecs would resolve elsewhere);
 *   - <wiki>/research must be a real directory and contain no symlinks (a write
 *     through either would land outside the folder);
 *   - the source dir must be outside the wiki repo.
 *
 * Cross-process note: writeAndPush's serialization is in-process only, so this
 * runs in a quiet window (like scripts/wiki/refresh-all.ts). It refuses when
 * tracked files outside research/ are dirty and commits with pathspec
 * `-- research`, so an app-side write can never enter its commit.
 */
import * as childProcess from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '@/lib/wiki/markdown-helpers';
import { okfResource, setFrontmatterLine } from '@/lib/ai/wiki/okf-frontmatter';
import { findResidualIdentifiers } from '@/lib/privacy/deterministic';
import { lintWiki } from '@/lib/ai/wiki/lint';

export class ResearchSyncRefusal extends Error {
  constructor(message: string) { super(message); this.name = 'ResearchSyncRefusal'; }
}

export interface ResearchSourcePage { file: string; slug: string; content: string }
export interface ResearchSyncPlan { write: string[]; remove: string[]; unchanged: string[] }
export interface ResearchSyncResult { plan: ResearchSyncPlan; applied: boolean; sha: string | null }

const SECTION = 'research';
const SKIP = new Set(['SOURCES.md']);
const FILE_RE = /^[a-z0-9-]+\.md$/;

function gitRaw(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile('git', ['-C', cwd, ...args], (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}
const git = async (cwd: string, args: string[]) => (await gitRaw(cwd, args)).trim();

async function realOrResolved(p: string): Promise<string> {
  try { return await fs.realpath(p); } catch { return path.resolve(p); }
}

async function defaultTimestamp(absPath: string): Promise<string> {
  try {
    const iso = await git(path.dirname(absPath), ['log', '-1', '--format=%cI', '--', path.basename(absPath)]);
    if (iso) return new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
  } catch { /* not a git checkout — fall through */ }
  return (await fs.stat(absPath)).mtime.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export async function readResearchSource(
  sourceDir: string,
  opts: { base?: string; timestampOf?: (absPath: string) => Promise<string> } = {},
): Promise<ResearchSourcePage[]> {
  const timestampOf = opts.timestampOf ?? defaultTimestamp;
  let files: string[];
  try {
    files = (await fs.readdir(sourceDir)).filter(f => f.endsWith('.md') && !SKIP.has(f)).sort();
  } catch {
    throw new ResearchSyncRefusal(`source dir not readable: ${sourceDir}`);
  }
  if (files.length === 0) throw new ResearchSyncRefusal(`no research pages in ${sourceDir}`);
  const out: ResearchSourcePage[] = [];
  for (const file of files) {
    if (!FILE_RE.test(file)) throw new ResearchSyncRefusal(`${file}: file names must be lowercase-hyphen slugs ending .md`);
    const slug = file.replace(/\.md$/, '');
    const abs = path.join(sourceDir, file);
    const raw = await fs.readFile(abs, 'utf8');
    const { frontmatter: fm } = parseFrontmatter(raw);
    if (fm.type !== 'research') throw new ResearchSyncRefusal(`${file}: frontmatter type must be "research"`);
    if (fm.slug !== slug) throw new ResearchSyncRefusal(`${file}: frontmatter slug must equal "${slug}"`);
    if (!fm.title || !fm.description) throw new ResearchSyncRefusal(`${file}: title and description are required`);
    const residual = findResidualIdentifiers(raw);
    if (residual.length > 0) throw new ResearchSyncRefusal(`${file}: ${residual.length} email/ID-like pattern(s); remove them before syncing`);
    let content = setFrontmatterLine(raw, 'resource', okfResource(SECTION, slug, opts.base));
    content = setFrontmatterLine(content, 'timestamp', await timestampOf(abs));
    out.push({ file, slug, content });
  }
  return out;
}

/** <wiki>/research, refusing a symlinked folder, a non-directory, or any symlink inside it. */
async function researchDir(wikiRoot: string): Promise<string> {
  const dir = path.join(wikiRoot, SECTION);
  let st;
  try { st = await fs.lstat(dir); } catch { return dir; } // absent → created on apply
  if (st.isSymbolicLink()) throw new ResearchSyncRefusal(`${dir} is a symlink; the sync only writes a real research/ folder`);
  if (!st.isDirectory()) throw new ResearchSyncRefusal(`${dir} exists and is not a directory`);
  const links = (await fs.readdir(dir, { withFileTypes: true })).filter(e => e.isSymbolicLink()).map(e => e.name);
  if (links.length > 0) throw new ResearchSyncRefusal(`${dir} contains symlink(s) (${links.join(', ')}); the sync never writes through a link`);
  return dir;
}

export async function planResearchSync(pages: ResearchSourcePage[], wikiRoot: string): Promise<ResearchSyncPlan> {
  const dir = await researchDir(wikiRoot);
  let existing: string[] = [];
  try { existing = (await fs.readdir(dir)).filter(f => f.endsWith('.md')); } catch { /* absent */ }
  const wanted = new Map(pages.map(p => [p.file, p.content]));
  const write: string[] = []; const unchanged: string[] = [];
  for (const [file, content] of wanted) {
    let cur: string | null = null;
    try { cur = await fs.readFile(path.join(dir, file), 'utf8'); } catch { /* new */ }
    (cur === content ? unchanged : write).push(file);
  }
  const remove = existing.filter(f => !wanted.has(f)).sort();
  return { write: write.sort(), remove, unchanged: unchanged.sort() };
}

async function restoreResearch(wikiRoot: string): Promise<void> {
  await git(wikiRoot, ['restore', '--source=HEAD', '--staged', '--worktree', '--', SECTION]).catch(() => undefined);
  await git(wikiRoot, ['clean', '-fdq', '--', SECTION]).catch(() => undefined);
}

/** Refuse unless `wikiRoot` is itself the top level of a git work tree. */
async function assertRepoTopLevel(wikiRoot: string): Promise<void> {
  let top: string;
  try { top = await git(wikiRoot, ['rev-parse', '--show-toplevel']); } catch {
    throw new ResearchSyncRefusal(`${wikiRoot} is not a git checkout`);
  }
  if ((await realOrResolved(top)) !== (await realOrResolved(wikiRoot))) {
    throw new ResearchSyncRefusal(`${wikiRoot} is not the top level of its git repo (${top})`);
  }
}

/** Tracked paths (staged or unstaged, both sides of any rename) changed outside research/. */
async function dirtyOutsideResearch(wikiRoot: string): Promise<string[]> {
  const out = await gitRaw(wikiRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=no', '--no-renames']);
  return out.split('\0').filter(Boolean).map(e => e.slice(3))
    .filter(p => p !== SECTION && !p.startsWith(`${SECTION}/`));
}

export async function syncResearch(opts: {
  sourceDir: string; wikiRoot: string; apply: boolean;
  remote?: string; branch?: string; base?: string;
  timestampOf?: (absPath: string) => Promise<string>;
}): Promise<ResearchSyncResult> {
  const wikiRoot = path.resolve(opts.wikiRoot);
  const sourceDir = path.resolve(opts.sourceDir);
  const realWiki = await realOrResolved(wikiRoot);
  const realSource = await realOrResolved(sourceDir);
  if (realSource === realWiki || realSource.startsWith(realWiki + path.sep)) {
    throw new ResearchSyncRefusal('source dir must be outside the wiki repo');
  }
  const remote = opts.remote ?? 'origin';
  const branch = opts.branch ?? 'main';
  const pages = await readResearchSource(sourceDir, { base: opts.base, timestampOf: opts.timestampOf });
  if (!opts.apply) return { plan: await planResearchSync(pages, wikiRoot), applied: false, sha: null };

  await assertRepoTopLevel(wikiRoot);
  await researchDir(wikiRoot); // symlink refusal before any git/fs write
  const dirty = await dirtyOutsideResearch(wikiRoot);
  if (dirty.length > 0) {
    throw new ResearchSyncRefusal(`wiki clone has tracked changes outside research/ (another writer mid-flight?): ${dirty.join('; ')}`);
  }
  await git(wikiRoot, ['pull', '-q', '--ff-only', remote, branch]);
  // The push sends every local commit the remote lacks, so refuse if any of
  // them touch paths outside research/ (only an earlier sync's unpushed
  // research/ commit may ride along; it gets pushed below).
  const aheadOutside = (await git(wikiRoot, ['diff', '--name-only', '--no-renames', 'FETCH_HEAD', 'HEAD']))
    .split('\n').filter(Boolean).filter(p => p !== SECTION && !p.startsWith(`${SECTION}/`));
  if (aheadOutside.length > 0) {
    throw new ResearchSyncRefusal(`wiki clone has unpushed commits touching paths outside research/: ${aheadOutside.join('; ')}`);
  }

  const plan = await planResearchSync(pages, wikiRoot); // re-checks symlinks after the pull
  const dir = path.join(wikiRoot, SECTION);
  try {
    await fs.mkdir(dir, { recursive: true });
    const byFile = new Map(pages.map(p => [p.file, p.content]));
    for (const f of plan.write) await fs.writeFile(path.join(dir, f), byFile.get(f)!);
    for (const f of plan.remove) await fs.rm(path.join(dir, f));
    const errors = (await lintWiki(wikiRoot)).filter(i => i.severity === 'error' && i.page.startsWith(`${SECTION}/`));
    if (errors.length > 0) {
      throw new ResearchSyncRefusal(`lint errors in research/: ${errors.map(e => `${e.page} ${e.kind}: ${e.detail}`).join('; ')}`);
    }
    await git(wikiRoot, ['add', '-A', '--', SECTION]);
    const staged = await git(wikiRoot, ['diff', '--cached', '--name-only', '--', SECTION]);
    if (staged) await git(wikiRoot, ['commit', '-q', '-m', `research: sync ${plan.write.length} written, ${plan.remove.length} removed`, '--', SECTION]);
  } catch (err) {
    await restoreResearch(wikiRoot);
    throw err;
  }
  // Nothing new and nothing unpushed (e.g. from an earlier failed push) → done.
  if ((await git(wikiRoot, ['rev-list', '--count', 'FETCH_HEAD..HEAD'])) === '0') {
    return { plan, applied: true, sha: null };
  }
  try {
    await git(wikiRoot, ['push', '-q', remote, branch]);
  } catch {
    try {
      await git(wikiRoot, ['pull', '--rebase', '-q', remote, branch]);
    } catch (err) {
      await git(wikiRoot, ['rebase', '--abort']).catch(() => undefined);
      throw err;
    }
    await git(wikiRoot, ['push', '-q', remote, branch]);
  }
  return { plan, applied: true, sha: await git(wikiRoot, ['rev-parse', 'HEAD']) };
}
