/**
 * Tests for lib/wiki/git-ops.ts
 *
 * All child_process.execFile calls and fs operations are mocked so no real
 * git invocations or disk writes happen.
 *
 * Coverage:
 *   - writeAndPush writes each page to the correct absolute path
 *   - writeAndPush creates parent directories before writing
 *   - writeAndPush appends (not overwrites) log.md
 *   - writeAndPush calls git pull --ff-only BEFORE any fs writes
 *   - writeAndPush calls git add -A, commit, push in the right order
 *   - On push failure: rebases + retries push exactly once
 *   - readWikiPage returns null for ENOENT instead of throwing
 *   - readWikiPage propagates non-ENOENT errors
 *   - resolvePagePath rejects absolute paths
 *   - resolvePagePath rejects ".." traversal that escapes the repo
 *   - wikiRepoPath returns the configured path
 *
 * Mock strategy: git-ops.ts imports `* as childProcess` and `* as nodeFs`
 * (namespace imports) so vi.spyOn on those namespace objects intercepts calls
 * in the module under test at call time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Namespace mocks — must be hoisted before any import that touches these
// modules. We mock the whole namespace so the module under test (which also
// does a namespace import) sees the same mock object.
// ---------------------------------------------------------------------------

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn() };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...(actual.promises ?? {}),
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      appendFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(''),
    },
  };
});

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------

import * as childProcess from 'node:child_process';
import * as nodeFs from 'node:fs';
import path from 'node:path';

import { writeAndPush, readWikiPage, wikiRepoPath } from '../git-ops';

// ---------------------------------------------------------------------------
// Types for mock introspection.
// ---------------------------------------------------------------------------

type ExecFileCb = (err: Error | null, stdout: string, stderr: string) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO = process.env.WIKI_REPO_PATH ?? '/Users/admin/projects/gc-curriculum-wiki';
const REMOTE = process.env.WIKI_REMOTE ?? 'origin';
const BRANCH = process.env.WIKI_BRANCH ?? 'main';

/** Fake SHA returned from `git rev-parse HEAD`. */
const FAKE_SHA = 'abc1234def5678901234567890abcdef12345678';

// Typed accessors for the mocked functions.
// Double-cast through unknown because the static types don't overlap with
// the vi.fn() mock type even though at runtime they are replaced by mocks.
const mockExecFile = () => childProcess.execFile as unknown as ReturnType<typeof vi.fn>;
const mockMkdir = () => nodeFs.promises.mkdir as unknown as ReturnType<typeof vi.fn>;
const mockWriteFile = () => nodeFs.promises.writeFile as unknown as ReturnType<typeof vi.fn>;
const mockAppendFile = () => nodeFs.promises.appendFile as unknown as ReturnType<typeof vi.fn>;
const mockReadFile = () => nodeFs.promises.readFile as unknown as ReturnType<typeof vi.fn>;

/**
 * Configure execFile mock so all git calls succeed immediately.
 * `git rev-parse HEAD` returns FAKE_SHA; everything else returns empty stdout.
 */
function setupExecFileSuccess() {
  mockExecFile().mockImplementation(
    (...callArgs: unknown[]) => {
      const args = callArgs[1] as string[];
      const cb = callArgs[callArgs.length - 1] as ExecFileCb;
      const stdout = args[args.length - 1] === 'HEAD' ? FAKE_SHA + '\n' : '';
      setImmediate(() => cb(null, stdout, ''));
    },
  );
}

/**
 * Configure execFile so the FIRST `git push` fails, but all subsequent calls
 * (pull --rebase + second push) succeed.
 */
function setupExecFileWithOnePushFailure() {
  let pushCount = 0;
  mockExecFile().mockImplementation(
    (...callArgs: unknown[]) => {
      const args = callArgs[1] as string[];
      const cb = callArgs[callArgs.length - 1] as ExecFileCb;

      if (args.includes('push')) {
        pushCount++;
        if (pushCount === 1) {
          setImmediate(() =>
            cb(new Error('rejected: non-fast-forward'), '', 'error: failed to push'),
          );
          return;
        }
      }

      const stdout = args[args.length - 1] === 'HEAD' ? FAKE_SHA + '\n' : '';
      setImmediate(() => cb(null, stdout, ''));
    },
  );
}

/** A minimal valid WikiCommit fixture. */
const COMMIT = {
  pages: [
    { path: 'courses/gc-4800.md', content: '# GC 4800\n' },
    { path: 'index.md', content: '# Index\n' },
  ],
  logEntry: '2026-06-01T00:00:00Z — ingest gc-4800',
  commitMessage: 'feat(gc-4800): snapshot 2026-06-01',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wikiRepoPath', () => {
  it('returns the configured WIKI_REPO_PATH', () => {
    expect(wikiRepoPath()).toBe(REPO);
  });
});

describe('writeAndPush — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupExecFileSuccess();
    mockMkdir().mockResolvedValue(undefined);
    mockWriteFile().mockResolvedValue(undefined);
    mockAppendFile().mockResolvedValue(undefined);
  });

  it('returns the HEAD sha', async () => {
    const result = await writeAndPush(COMMIT);
    expect(result.sha).toBe(FAKE_SHA);
  });

  it('calls git pull --ff-only as the first git operation', async () => {
    await writeAndPush(COMMIT);

    const calls = mockExecFile().mock.calls as unknown[][];
    expect(calls.length).toBeGreaterThan(0);
    const firstArgs = calls[0]![1] as string[];
    expect(firstArgs).toContain('pull');
    expect(firstArgs).toContain('--ff-only');
    expect(firstArgs).toContain(REMOTE);
    expect(firstArgs).toContain(BRANCH);
  });

  it('calls git pull --ff-only BEFORE any fs.writeFile calls', async () => {
    const callOrder: string[] = [];

    mockExecFile().mockImplementation(
      (...callArgs: unknown[]) => {
        const args = callArgs[1] as string[];
        const cb = callArgs[callArgs.length - 1] as ExecFileCb;
        const op = args.find(a => ['pull', 'add', 'commit', 'rev-parse', 'push'].includes(a));
        callOrder.push(`git:${op ?? '?'}`);
        const stdout = args[args.length - 1] === 'HEAD' ? FAKE_SHA + '\n' : '';
        setImmediate(() => cb(null, stdout, ''));
      },
    );

    mockWriteFile().mockImplementation(async () => {
      callOrder.push('fs:writeFile');
    });

    await writeAndPush(COMMIT);

    const pullIndex = callOrder.findIndex(s => s === 'git:pull');
    const firstWriteIndex = callOrder.findIndex(s => s === 'fs:writeFile');

    expect(pullIndex).toBeGreaterThanOrEqual(0);
    expect(firstWriteIndex).toBeGreaterThanOrEqual(0);
    expect(pullIndex).toBeLessThan(firstWriteIndex);
  });

  it('writes each page to the correct absolute path', async () => {
    await writeAndPush(COMMIT);

    const writtenPaths = (mockWriteFile().mock.calls as [string, string][]).map(c => c[0]);
    expect(writtenPaths).toContain(path.join(REPO, 'courses/gc-4800.md'));
    expect(writtenPaths).toContain(path.join(REPO, 'index.md'));
  });

  it('writes the correct content to each page', async () => {
    await writeAndPush(COMMIT);

    const writeCalls = mockWriteFile().mock.calls as [string, string][];
    const courseWrite = writeCalls.find(c => c[0] === path.join(REPO, 'courses/gc-4800.md'));
    expect(courseWrite).toBeDefined();
    expect(courseWrite![1]).toBe('# GC 4800\n');
  });

  it('creates parent directories for each page before writing', async () => {
    await writeAndPush(COMMIT);

    const mkdirPaths = (mockMkdir().mock.calls as [string, { recursive: boolean }][]).map(c => c[0]);
    // courses/gc-4800.md → parent is <repo>/courses
    expect(mkdirPaths).toContain(path.join(REPO, 'courses'));
    // index.md → parent is <repo> itself
    expect(mkdirPaths).toContain(REPO);
  });

  it('passes { recursive: true } to mkdir', async () => {
    await writeAndPush(COMMIT);

    const mkdirCalls = mockMkdir().mock.calls as [string, { recursive: boolean }][];
    for (const call of mkdirCalls) {
      expect(call[1]).toEqual({ recursive: true });
    }
  });

  it('appends (not overwrites) the log entry to log.md', async () => {
    await writeAndPush(COMMIT);

    const appendCalls = mockAppendFile().mock.calls as [string, string][];
    const logAppend = appendCalls.find(c => c[0] === path.join(REPO, 'log.md'));
    expect(logAppend).toBeDefined();
    expect(logAppend![1]).toContain(COMMIT.logEntry);

    // fs.writeFile must NOT be called for log.md.
    const writeCalls = mockWriteFile().mock.calls as [string, string][];
    const logWrite = writeCalls.find(c => c[0] === path.join(REPO, 'log.md'));
    expect(logWrite).toBeUndefined();
  });

  it('calls git add -A after writing pages', async () => {
    await writeAndPush(COMMIT);

    const calls = mockExecFile().mock.calls as unknown[][];
    const addCall = calls.find(c => (c[1] as string[]).includes('add'));
    expect(addCall).toBeDefined();
    expect(addCall![1] as string[]).toContain('-A');
  });

  it('calls git commit with the specified message', async () => {
    await writeAndPush(COMMIT);

    const calls = mockExecFile().mock.calls as unknown[][];
    const commitCall = calls.find(c => (c[1] as string[]).includes('commit'));
    expect(commitCall).toBeDefined();
    const args = commitCall![1] as string[];
    const msgIndex = args.indexOf('-m');
    expect(msgIndex).toBeGreaterThanOrEqual(0);
    expect(args[msgIndex + 1]).toBe(COMMIT.commitMessage);
  });

  it('calls git push after commit', async () => {
    const callOrder: string[] = [];

    mockExecFile().mockImplementation(
      (...callArgs: unknown[]) => {
        const args = callArgs[1] as string[];
        const cb = callArgs[callArgs.length - 1] as ExecFileCb;
        const op = args.find(a => ['pull', 'add', 'commit', 'rev-parse', 'push'].includes(a));
        if (op) callOrder.push(op);
        const stdout = args[args.length - 1] === 'HEAD' ? FAKE_SHA + '\n' : '';
        setImmediate(() => cb(null, stdout, ''));
      },
    );

    await writeAndPush(COMMIT);

    const commitIdx = callOrder.lastIndexOf('commit');
    const pushIdx = callOrder.lastIndexOf('push');
    expect(commitIdx).toBeGreaterThanOrEqual(0);
    expect(pushIdx).toBeGreaterThan(commitIdx);
  });

  it('calls git add -A before git commit', async () => {
    const callOrder: string[] = [];

    mockExecFile().mockImplementation(
      (...callArgs: unknown[]) => {
        const args = callArgs[1] as string[];
        const cb = callArgs[callArgs.length - 1] as ExecFileCb;
        const op = args.find(a => ['pull', 'add', 'commit', 'rev-parse', 'push'].includes(a));
        if (op) callOrder.push(op);
        const stdout = args[args.length - 1] === 'HEAD' ? FAKE_SHA + '\n' : '';
        setImmediate(() => cb(null, stdout, ''));
      },
    );

    await writeAndPush(COMMIT);

    const addIdx = callOrder.indexOf('add');
    const commitIdx = callOrder.indexOf('commit');
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(commitIdx).toBeGreaterThan(addIdx);
  });
});

describe('writeAndPush — push failure + retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupExecFileWithOnePushFailure();
    mockMkdir().mockResolvedValue(undefined);
    mockWriteFile().mockResolvedValue(undefined);
    mockAppendFile().mockResolvedValue(undefined);
  });

  it('retries push exactly once after a rebase on push failure', async () => {
    await writeAndPush(COMMIT);

    const calls = mockExecFile().mock.calls as unknown[][];
    const pushCalls = calls.filter(c => (c[1] as string[]).includes('push'));
    expect(pushCalls).toHaveLength(2);
  });

  it('issues pull --rebase between the failed push and the retry push', async () => {
    await writeAndPush(COMMIT);

    const calls = mockExecFile().mock.calls as unknown[][];
    const ops = calls.map(c => {
      const args = c[1] as string[];
      if (args.includes('push')) return 'push';
      if (args.includes('pull') && args.includes('--rebase')) return 'pull:rebase';
      if (args.includes('pull') && args.includes('--ff-only')) return 'pull:ff-only';
      return args.find(a => ['add', 'commit', 'rev-parse'].includes(a)) ?? '?';
    });

    const firstPushIdx = ops.indexOf('push');
    const rebaseIdx = ops.indexOf('pull:rebase');
    const secondPushIdx = ops.lastIndexOf('push');

    expect(rebaseIdx).toBeGreaterThan(firstPushIdx);
    expect(secondPushIdx).toBeGreaterThan(rebaseIdx);
  });

  it('still returns the sha after a successful retry', async () => {
    const result = await writeAndPush(COMMIT);
    expect(result.sha).toBe(FAKE_SHA);
  });

  it('throws if both the first and retry push fail', async () => {
    mockExecFile().mockImplementation(
      (...callArgs: unknown[]) => {
        const args = callArgs[1] as string[];
        const cb = callArgs[callArgs.length - 1] as ExecFileCb;
        if (args.includes('push')) {
          setImmediate(() => cb(new Error('rejected: non-fast-forward'), '', ''));
          return;
        }
        const stdout = args[args.length - 1] === 'HEAD' ? FAKE_SHA + '\n' : '';
        setImmediate(() => cb(null, stdout, ''));
      },
    );

    await expect(writeAndPush(COMMIT)).rejects.toThrow();
  });

  it('does NOT issue a third push attempt', async () => {
    mockExecFile().mockImplementation(
      (...callArgs: unknown[]) => {
        const args = callArgs[1] as string[];
        const cb = callArgs[callArgs.length - 1] as ExecFileCb;
        if (args.includes('push')) {
          setImmediate(() => cb(new Error('rejected'), '', ''));
          return;
        }
        const stdout = args[args.length - 1] === 'HEAD' ? FAKE_SHA + '\n' : '';
        setImmediate(() => cb(null, stdout, ''));
      },
    );

    try {
      await writeAndPush(COMMIT);
    } catch {
      // expected
    }

    const calls = mockExecFile().mock.calls as unknown[][];
    const pushCalls = calls.filter(c => (c[1] as string[]).includes('push'));
    expect(pushCalls).toHaveLength(2);
  });
});

describe('writeAndPush — path traversal guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupExecFileSuccess();
    mockMkdir().mockResolvedValue(undefined);
    mockWriteFile().mockResolvedValue(undefined);
    mockAppendFile().mockResolvedValue(undefined);
  });

  it('throws on absolute page paths', async () => {
    const badCommit = {
      ...COMMIT,
      pages: [{ path: '/etc/passwd', content: 'pwned' }],
    };
    await expect(writeAndPush(badCommit)).rejects.toThrow(/absolute path/);
  });

  it('throws when ".." escapes the repo root', async () => {
    const badCommit = {
      ...COMMIT,
      pages: [{ path: '../../etc/passwd', content: 'pwned' }],
    };
    await expect(writeAndPush(badCommit)).rejects.toThrow(/path traversal/);
  });

  it('allows nested relative paths within the repo', async () => {
    const goodCommit = {
      ...COMMIT,
      pages: [{ path: 'raw/snapshots/gc-4800/2026-06-01_abc1234.json', content: '{}' }],
    };
    await expect(writeAndPush(goodCommit)).resolves.toBeDefined();
  });
});

describe('readWikiPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns file contents when the file exists', async () => {
    mockReadFile().mockResolvedValue('# GC 4800\n');
    const result = await readWikiPage('courses/gc-4800.md');
    expect(result).toBe('# GC 4800\n');
  });

  it('returns null when the file does not exist (ENOENT)', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    mockReadFile().mockRejectedValue(enoent);
    const result = await readWikiPage('courses/gc-9999.md');
    expect(result).toBeNull();
  });

  it('propagates non-ENOENT errors', async () => {
    const permissionErr = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    mockReadFile().mockRejectedValue(permissionErr);
    await expect(readWikiPage('courses/gc-4800.md')).rejects.toThrow('EACCES');
  });

  it('reads from the path relative to WIKI_REPO_PATH', async () => {
    mockReadFile().mockResolvedValue('content');
    await readWikiPage('index.md');
    expect(mockReadFile()).toHaveBeenCalledWith(
      path.join(REPO, 'index.md'),
      'utf8',
    );
  });
});
