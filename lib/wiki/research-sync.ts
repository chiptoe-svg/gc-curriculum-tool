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
 *   - <wiki>/research must be named exactly `research` (no case-variant
 *     top-level entry, tracked or on disk: on case-insensitive APFS a write
 *     would land in `Research/`, which git's case-sensitive pathspec misses);
 *   - <wiki>/research must be a real directory holding only regular *.md
 *     files: no symlinks or hard links (a write through either would land
 *     outside the folder), no subdirectories or other entries (refused, never
 *     removed, so a hand-placed file is never committed or deleted);
 *   - the clone must have <branch> checked out (no detached HEAD), so the
 *     commit lands on and `push HEAD:<branch>` publishes exactly that branch;
 *   - the source dir must be outside the wiki repo.
 * The dry run runs the same read-only checks, so a clean dry run predicts
 * --apply except for lint, which runs only after writing. Its one side effect
 * is the fetch, which updates FETCH_HEAD and the remote-tracking ref
 * (refs/remotes/<remote>/<branch>); the work tree and local branches never move.
 * After a commit (or a failed apply) research/ must show no changes in
 * `git status`; anything left over is a loud error, never pushed.
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
/**
 * `sha` is the commit this run pushed (its own, or an earlier sync's unpushed
 * research/ commit), as read back from the remote; null when nothing was pushed.
 * `committed` is true only when this run made a new commit.
 */
export interface ResearchSyncResult { plan: ResearchSyncPlan; applied: boolean; sha: string | null; committed: boolean }

const SECTION = 'research';
const SKIP = new Set(['SOURCES.md']);
const FILE_RE = /^[a-z0-9-]+\.md$/;
/** Markdown-looking names; anything matching must be exactly `<slug>.md`. */
const MD_LIKE_RE = /\.(md|markdown|mdown|mkdn?|mdwn|mdtxt|mdtext)$/i;
/** index.md would be read as a section index; the lead page is the-case. */
const RESERVED = new Set(['index.md']);

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
    files = (await fs.readdir(sourceDir)).filter(f => MD_LIKE_RE.test(f) && !SKIP.has(f)).sort();
  } catch {
    throw new ResearchSyncRefusal(`source dir not readable: ${sourceDir}`);
  }
  // Refuse (never skip) a markdown file with another extension: skipping it
  // would silently delete its wiki page.
  for (const f of files) {
    if (!f.endsWith('.md')) throw new ResearchSyncRefusal(`${f}: research pages must use the lowercase .md extension`);
    if (RESERVED.has(f)) throw new ResearchSyncRefusal(`${f}: reserved name (the lead research page is the-case.md)`);
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

/**
 * <wiki>/research, refusing a symlinked folder, a non-directory, or any entry
 * inside it that is not a single-link regular *.md file (symlink, hard link,
 * subdirectory, .DS_Store, ...). Refused, never removed: the folder is
 * sync-owned, so anything else in it needs a human look.
 */
async function researchDir(wikiRoot: string): Promise<string> {
  const dir = path.join(wikiRoot, SECTION);
  // A case variant (Research/, RESEARCH) on disk or in the index: on a
  // case-insensitive file system lstat('research') would resolve into it while
  // the `-- research` pathspec matches nothing, leaving the clone dirty.
  const tracked = (await gitRaw(wikiRoot, ['ls-files', '-z'])).split('\0').filter(Boolean).map(p => p.split('/')[0]!);
  const variants = [...new Set([...(await fs.readdir(wikiRoot)), ...tracked])]
    .filter(n => n.toLowerCase() === SECTION && n !== SECTION).sort();
  if (variants.length > 0) {
    throw new ResearchSyncRefusal(`wiki has a case variant of research/ (${variants.join(', ')}); rename or remove it by hand — the sync only manages a folder named exactly "research"`);
  }
  let st;
  try { st = await fs.lstat(dir); } catch { return dir; } // absent → created on apply
  if (st.isSymbolicLink()) throw new ResearchSyncRefusal(`${dir} is a symlink; the sync only writes a real research/ folder`);
  if (!st.isDirectory()) throw new ResearchSyncRefusal(`${dir} exists and is not a directory`);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const links = entries.filter(e => e.isSymbolicLink()).map(e => e.name);
  if (links.length > 0) throw new ResearchSyncRefusal(`${dir} contains symlink(s) (${links.join(', ')}); the sync never writes through a link`);
  const other = entries.filter(e => !e.isFile() || !e.name.endsWith('.md')).map(e => e.name);
  if (other.length > 0) {
    throw new ResearchSyncRefusal(`${dir} contains non-.md entries or subdirectories (${other.join(', ')}); remove them by hand — the sync manages only *.md files`);
  }
  const hard: string[] = [];
  for (const e of entries) if ((await fs.lstat(path.join(dir, e.name))).nlink > 1) hard.push(e.name);
  if (hard.length > 0) throw new ResearchSyncRefusal(`${dir} contains hard-linked file(s) (${hard.join(', ')}); a write would change a file outside research/`);
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

/**
 * Changes (staged, unstaged or untracked) under research/ or a case variant of
 * it, as `XY path` lines; empty when research/ matches HEAD.
 */
async function researchStatus(wikiRoot: string): Promise<string[]> {
  const out = await gitRaw(wikiRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  return out.split('\0').filter(Boolean)
    .filter(e => e.slice(3).split('/')[0]!.toLowerCase() === SECTION);
}

/**
 * Put research/ back to HEAD; returns the failures (empty when it is clean
 * again). Clean-or-not is decided from `git status`, not the exit codes: on a
 * first sync research/ is absent from HEAD, so `restore` fails on its
 * pathspec although `clean` leaves research/ clean.
 */
async function restoreResearch(wikiRoot: string): Promise<string[]> {
  const failures: string[] = [];
  const attempt = async (args: string[]) => {
    try { await git(wikiRoot, args); } catch (e) { failures.push(`git ${args.join(' ')}: ${e instanceof Error ? e.message.trim() : String(e)}`); }
  };
  await attempt(['restore', '--source=HEAD', '--staged', '--worktree', '--', SECTION]);
  await attempt(['clean', '-fdq', '--', SECTION]);
  let left: string[];
  try { left = await researchStatus(wikiRoot); } catch (e) {
    return [...failures, `git status: ${e instanceof Error ? e.message.trim() : String(e)}`];
  }
  return left.length === 0 ? [] : [...failures, `still changed: ${left.join(', ')}`];
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

/** Refuse unless `branch` is checked out (a detached HEAD is refused too). */
async function assertOnBranch(wikiRoot: string, branch: string): Promise<void> {
  // Full ref, not --short: with a tag also named <branch>, --short prints
  // "heads/<branch>" and a legitimate run would be refused.
  let current: string;
  try { current = await git(wikiRoot, ['symbolic-ref', '--quiet', 'HEAD']); } catch {
    throw new ResearchSyncRefusal(`wiki clone has a detached HEAD; check out ${branch} first`);
  }
  if (current !== `refs/heads/${branch}`) {
    throw new ResearchSyncRefusal(`wiki clone is on branch "${current.replace(/^refs\/heads\//, '')}", not "${branch}"; check out ${branch} first`);
  }
}

/** Paths outside research/ that local commits not on the fetched remote change. */
async function aheadOutsideResearch(wikiRoot: string): Promise<string[]> {
  return (await git(wikiRoot, ['diff', '--name-only', '--no-renames', 'FETCH_HEAD...HEAD']))
    .split('\n').filter(Boolean).filter(p => p !== SECTION && !p.startsWith(`${SECTION}/`));
}

/**
 * The read-only checks, shared by the dry run and --apply. The fetch updates
 * FETCH_HEAD and the remote-tracking ref; the work tree and local branches
 * never move.
 */
async function preflight(wikiRoot: string, remote: string, branch: string): Promise<void> {
  await assertRepoTopLevel(wikiRoot);
  await assertOnBranch(wikiRoot, branch);
  await researchDir(wikiRoot); // symlink / hard-link / stray-entry refusal before any git or fs write
  const dirty = await dirtyOutsideResearch(wikiRoot);
  if (dirty.length > 0) {
    throw new ResearchSyncRefusal(`wiki clone has tracked changes outside research/ (another writer mid-flight?): ${dirty.join('; ')}`);
  }
  await git(wikiRoot, ['fetch', '-q', remote, branch]);
  const ancestor = (a: string, b: string) => git(wikiRoot, ['merge-base', '--is-ancestor', a, b]).then(() => true, () => false);
  if (!(await ancestor('HEAD', 'FETCH_HEAD')) && !(await ancestor('FETCH_HEAD', 'HEAD'))) {
    throw new ResearchSyncRefusal(`wiki clone's ${branch} has diverged from ${remote}/${branch}; reconcile it by hand first`);
  }
  // The push sends every local commit the remote lacks, so refuse if any of
  // them touch paths outside research/ (only an earlier sync's unpushed
  // research/ commit may ride along; it gets pushed by --apply).
  const ahead = await aheadOutsideResearch(wikiRoot);
  if (ahead.length > 0) {
    throw new ResearchSyncRefusal(`wiki clone has unpushed commits touching paths outside research/: ${ahead.join('; ')}`);
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
  await preflight(wikiRoot, remote, branch);
  if (!opts.apply) return { plan: await planResearchSync(pages, wikiRoot), applied: false, sha: null, committed: false };

  await git(wikiRoot, ['pull', '-q', '--ff-only', remote, branch]);
  // Re-check after the pull (the remote may have moved since the preflight fetch).
  await assertOnBranch(wikiRoot, branch);
  const aheadOutside = await aheadOutsideResearch(wikiRoot);
  if (aheadOutside.length > 0) {
    throw new ResearchSyncRefusal(`wiki clone has unpushed commits touching paths outside research/: ${aheadOutside.join('; ')}`);
  }

  const plan = await planResearchSync(pages, wikiRoot); // re-checks symlinks after the pull
  const dir = path.join(wikiRoot, SECTION);
  let committed = false;
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
    if (staged) {
      await git(wikiRoot, ['commit', '-q', '-m', `research: sync ${plan.write.length} written, ${plan.remove.length} removed`, '--', SECTION]);
      committed = true;
    }
  } catch (err) {
    const failures = await restoreResearch(wikiRoot);
    if (failures.length > 0) {
      // Not a refusal: the clone may now be dirty, and the next writer's
      // `git add -A` would commit it. Say so, with the reset command.
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}\n` +
        `research/ may be dirty: restoring it to HEAD failed (${failures.join('; ')}). Reset it with:\n` +
        `  git -C ${wikiRoot} restore --source=HEAD --staged --worktree -- research && git -C ${wikiRoot} clean -fd -- research`,
      );
    }
    throw err;
  }
  // Postcondition: the commit left nothing under research/ changed. Anything
  // left (a hook, a concurrent writer) would ride into the next writer's
  // `git add -A`, so stop before pushing and say so.
  const left = await researchStatus(wikiRoot);
  if (left.length > 0) {
    throw new Error(
      `research/ left dirty after the commit (${left.join(', ')}); nothing was pushed. ` +
      `Inspect ${wikiRoot}, clean research/ by hand, then rerun (a rerun pushes ${committed ? 'this run\'s' : 'any earlier'} unpushed sync commit).`,
    );
  }
  // Nothing new and nothing unpushed (e.g. from an earlier failed push) → done.
  if ((await git(wikiRoot, ['rev-list', '--count', 'FETCH_HEAD..HEAD'])) === '0') {
    return { plan, applied: true, sha: null, committed };
  }
  // Push exactly HEAD (the checked-out <branch>, asserted above) to <branch>.
  const refspec = `HEAD:refs/heads/${branch}`;
  try {
    await git(wikiRoot, ['push', '-q', remote, refspec]);
  } catch {
    try {
      await git(wikiRoot, ['pull', '--rebase', '-q', remote, branch]);
    } catch (err) {
      await git(wikiRoot, ['rebase', '--abort']).catch(() => undefined);
      throw err;
    }
    await git(wikiRoot, ['push', '-q', remote, refspec]);
  }
  // Report what the remote now holds, and fail loudly if it is not our HEAD.
  const head = await git(wikiRoot, ['rev-parse', 'HEAD']);
  const remoteSha = (await git(wikiRoot, ['ls-remote', remote, `refs/heads/${branch}`])).split(/\s+/)[0] ?? '';
  if (remoteSha !== head) throw new Error(`push reported success but ${remote}/${branch} is ${remoteSha || '(missing)'}, not ${head}`);
  return { plan, applied: true, sha: remoteSha, committed };
}
