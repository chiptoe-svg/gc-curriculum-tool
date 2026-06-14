/**
 * Wiki git-ops helper.
 *
 * The ONLY module that writes to the gc-curriculum-wiki repo on disk.
 * All writes go through writeAndPush(); nothing else should call fs.writeFile
 * directly against the wiki clone.
 *
 * Safety guarantees:
 *   - Uses execFile (not exec) so paths with spaces / shell metacharacters
 *     cannot escape into the shell.
 *   - Path traversal guard: each page.path is validated to stay inside
 *     WIKI_REPO_PATH before any fs call. Paths that would escape (via ".."
 *     or absolute paths) are rejected with an error.
 *   - One retry on push failure (handles a parallel-snapshot race via
 *     pull --rebase). On total failure the error propagates to the caller.
 *
 * Testability note: we import `childProcess` as a namespace object and call
 * `childProcess.execFile(...)` rather than destructuring `execFile` at
 * module-load time. This lets test code swap `childProcess.execFile` via
 * vi.spyOn or module-level vi.mock and have the replacement visible to this
 * module at call time. Same pattern for `nodeFs`.
 */

import * as childProcess from 'node:child_process';
import * as nodeFs from 'node:fs';
import path from 'node:path';
import { rebuildSectionIndexes } from '@/lib/ai/wiki/section-index';

const WIKI_REPO_PATH =
  process.env.WIKI_REPO_PATH ?? '/Users/admin/projects/gc-curriculum-wiki';
const WIKI_REMOTE = process.env.WIKI_REMOTE ?? 'origin';
const WIKI_BRANCH = process.env.WIKI_BRANCH ?? 'main';

export interface WikiCommit {
  pages: Array<{ path: string; content: string }>;
  logEntry: string;
  commitMessage: string;
}

// ---------------------------------------------------------------------------
// Internal exec helper
//
// Wraps childProcess.execFile in a Promise. We access childProcess.execFile
// via the namespace object (not a destructured import) so that vi.mock
// replacements in tests are picked up at call time rather than module-init.
// We build our own Promise wrapper instead of using promisify so we don't
// depend on execFile's util.promisify.custom symbol being present on the mock.
// ---------------------------------------------------------------------------

function exec(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(file, args, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

function fsPromises() {
  return nodeFs.promises;
}

// ---------------------------------------------------------------------------
// Path-traversal guard
// ---------------------------------------------------------------------------

/**
 * Resolve a relative wiki page path and validate it stays inside the repo.
 * Throws if the resolved path escapes WIKI_REPO_PATH.
 */
function resolvePagePath(relPath: string): string {
  // Reject absolute paths outright.
  if (path.isAbsolute(relPath)) {
    throw new Error(
      `wiki-ops: page path must be relative, got absolute path: ${relPath}`,
    );
  }

  const repoAbs = path.resolve(WIKI_REPO_PATH);
  const abs = path.resolve(repoAbs, relPath);

  // The resolved path must start with the canonical repo path + separator to
  // prevent writing to e.g. /Users/admin/projects/gc-curriculum-wiki-other/.
  if (!abs.startsWith(repoAbs + path.sep) && abs !== repoAbs) {
    throw new Error(
      `wiki-ops: path traversal detected — "${relPath}" resolves outside wiki repo (${abs})`,
    );
  }

  return abs;
}

// ---------------------------------------------------------------------------
// writeAndPush
// ---------------------------------------------------------------------------

// In-process serialization queue. Multiple concurrent regenerations — the
// common case after a program-wide coverage refresh fires one background regen
// per scored snapshot — would otherwise race on ONE git working tree: one run's
// `git add -A` stages another run's half-written files, `git commit` fails with
// "nothing to commit" or commits the wrong file set, and concurrent
// `pull --rebase` aborts mid-rebase. The push-retry below handles only a REMOTE
// race, not this LOCAL same-tree race. Chaining every writeAndPush off a single
// module-level promise guarantees one write→commit→push completes before the
// next begins. The chain pointer swallows rejections so one failure doesn't
// poison subsequent calls, but each call's own promise still rejects normally.
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Write each page to the wiki repo, append the log entry, commit, and push.
 * Serialized: concurrent calls run one-at-a-time on the shared working tree.
 *
 * Order of operations (per call):
 *   1. git pull --ff-only  (minimise conflict surface)
 *   2. Write each page (mkdir -p parent as needed)
 *   3. Append log entry to log.md
 *   4. git add -A
 *   5. git commit -m <commitMessage>
 *   6. git push (one retry after pull --rebase on failure)
 *   7. Return { sha } of the new HEAD commit
 *
 * On total failure, throws — the caller decides whether to flag the snapshot
 * as "wiki out of sync" or simply log and continue.
 */
export function writeAndPush(commit: WikiCommit): Promise<{ sha: string }> {
  const run = writeQueue.then(
    () => writeAndPushSerial(commit),
    () => writeAndPushSerial(commit),
  );
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function writeAndPushSerial(commit: WikiCommit): Promise<{ sha: string }> {
  const fs = fsPromises();

  // 1. Pull latest to minimise conflict surface.
  await exec('git', ['-C', WIKI_REPO_PATH, 'pull', '--ff-only', WIKI_REMOTE, WIKI_BRANCH]);

  // 2. Write each page (path-traversal guard applied to every entry).
  for (const page of commit.pages) {
    const abs = resolvePagePath(page.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, page.content);
  }

  // 2b. Rebuild the per-section index.md hubs from the full on-disk page set
  //     (the regen only touched the affected pages; indexes must reflect all).
  await rebuildSectionIndexes(WIKI_REPO_PATH);

  // 3. Append log entry to log.md (never overwrite — append-only log).
  const logPath = path.join(WIKI_REPO_PATH, 'log.md');
  await fs.appendFile(logPath, `\n${commit.logEntry}\n`);

  // 4. Stage everything.
  await exec('git', ['-C', WIKI_REPO_PATH, 'add', '-A']);

  // 5. Commit.
  await exec('git', ['-C', WIKI_REPO_PATH, 'commit', '-m', commit.commitMessage]);

  // 6. Capture HEAD sha before push attempt.
  const { stdout: shaRaw } = await exec('git', ['-C', WIKI_REPO_PATH, 'rev-parse', 'HEAD']);

  // 7. Push — one retry via rebase on failure (parallel-snapshot race).
  try {
    await exec('git', ['-C', WIKI_REPO_PATH, 'push', WIKI_REMOTE, WIKI_BRANCH]);
  } catch (_pushErr) {
    // Another snapshot committed + pushed concurrently. Rebase our commit on
    // top of the remote, then retry the push exactly once.
    await exec('git', ['-C', WIKI_REPO_PATH, 'pull', '--rebase', WIKI_REMOTE, WIKI_BRANCH]);
    await exec('git', ['-C', WIKI_REPO_PATH, 'push', WIKI_REMOTE, WIKI_BRANCH]);
  }

  return { sha: shaRaw.trim() };
}

// ---------------------------------------------------------------------------
// readWikiPage
// ---------------------------------------------------------------------------

/**
 * Read a wiki page from the local clone. Returns null when the file does not
 * exist instead of throwing. Any other fs error propagates normally.
 */
export async function readWikiPage(relPath: string): Promise<string | null> {
  const fs = fsPromises();
  // Apply the same traversal guard as the write path — absolute paths and
  // '..' segments are rejected before fs.readFile is invoked. Defense in
  // depth: the in-app /wiki routes already validate the URL segments, but
  // the helper itself must be self-protecting (it's also called from
  // lib/ai/wiki/update.ts and any future caller).
  let abs: string;
  try {
    abs = resolvePagePath(relPath);
  } catch {
    return null;
  }
  try {
    return await fs.readFile(abs, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// wikiRepoPath
// ---------------------------------------------------------------------------

/** Expose the configured wiki repo path (used by downstream modules). */
export function wikiRepoPath(): string {
  return WIKI_REPO_PATH;
}
