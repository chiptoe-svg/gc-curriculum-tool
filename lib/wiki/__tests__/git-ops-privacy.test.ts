/**
 * Privacy-scrub spec 2026-10-05, Layer 2: writeAndPush scrubs every page and
 * withholds any page that still carries an email or student-ID pattern.
 * Same execFile/fs mock strategy as git-ops.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('@/lib/ai/wiki/section-index', () => ({ rebuildSectionIndexes: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/privacy/scrub', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/privacy/scrub')>();
  return { ...actual, scrubForRecord: vi.fn(actual.scrubForRecord) };
});

import * as childProcess from 'node:child_process';
import * as nodeFs from 'node:fs';
import path from 'node:path';
import { scrubForRecord } from '@/lib/privacy/scrub';
import { writeAndPush, WikiPagesWithheldError } from '../git-ops';

const REPO = process.env.WIKI_REPO_PATH ?? '/Users/admin/projects/gc-curriculum-wiki';
const FAKE_SHA = 'abc1234def5678901234567890abcdef12345678';
type ExecFileCb = (err: Error | null, stdout: string, stderr: string) => void;
const mockExecFile = () => childProcess.execFile as unknown as ReturnType<typeof vi.fn>;
const mockWriteFile = () => nodeFs.promises.writeFile as unknown as ReturnType<typeof vi.fn>;
const mockAppendFile = () => nodeFs.promises.appendFile as unknown as ReturnType<typeof vi.fn>;

function setupExecFileSuccess() {
  mockExecFile().mockImplementation((...callArgs: unknown[]) => {
    const args = callArgs[1] as string[];
    const cb = callArgs[callArgs.length - 1] as ExecFileCb;
    const stdout = args[args.length - 1] === 'HEAD' ? FAKE_SHA + '\n' : '';
    setImmediate(() => cb(null, stdout, ''));
  });
}
const writtenPaths = () => mockWriteFile().mock.calls.map(c => c[0] as string);
const gitArgs = () => mockExecFile().mock.calls.map(c => (c[1] as string[]).join(' '));

beforeEach(async () => {
  vi.clearAllMocks();
  setupExecFileSuccess();
  const actual = await vi.importActual<typeof import('@/lib/privacy/scrub')>('@/lib/privacy/scrub');
  vi.mocked(scrubForRecord).mockReset().mockImplementation(actual.scrubForRecord);
});

describe('writeAndPush — privacy scrub (Layer 2)', () => {
  it('writes pages with emails and student IDs replaced', async () => {
    await writeAndPush({
      pages: [{ path: 'courses/gc-4800.md', content: '# GC 4800\nContact prof@clemson.edu. Student C12345678 presented.\n' }],
      logEntry: '2026-10-05 — gc-4800',
      commitMessage: 'feat(gc-4800): snapshot',
    });
    expect(mockWriteFile()).toHaveBeenCalledWith(
      path.join(REPO, 'courses/gc-4800.md'),
      '# GC 4800\nContact [email]. Student [student ID] presented.\n',
    );
  });

  it('withholds a page that still fails the hard check, writes and pushes the rest, then throws', async () => {
    const actual = await vi.importActual<typeof import('@/lib/privacy/scrub')>('@/lib/privacy/scrub');
    vi.mocked(scrubForRecord).mockImplementation(async (text, opts) =>
      opts.fileName === 'courses/leaky.md'
        ? { text, redactions: { 'student-name': 0, 'student-id': 0, email: 0, ssn: 0 } } // a scrub that missed it
        : actual.scrubForRecord(text, opts));
    const p = writeAndPush({
      pages: [
        { path: 'courses/leaky.md', content: 'Reach jane@g.clemson.edu' },
        { path: 'courses/clean.md', content: '# Clean\n' },
      ],
      logEntry: 'entry',
      commitMessage: 'msg',
    });
    await expect(p).rejects.toBeInstanceOf(WikiPagesWithheldError);
    const err = (await p.catch(e => e as WikiPagesWithheldError)) as WikiPagesWithheldError;
    expect(err.sha).toBe(FAKE_SHA);
    expect(err.withheld).toEqual([{ path: 'courses/leaky.md', reason: '1 email/student-ID pattern(s) remain after the privacy scrub' }]);
    expect(err.message).not.toContain('jane@');
    expect(writtenPaths()).toContain(path.join(REPO, 'courses/clean.md'));
    expect(writtenPaths()).not.toContain(path.join(REPO, 'courses/leaky.md'));
    expect(gitArgs().some(a => a.includes(' push '))).toBe(true);
  });

  it('withholds a page whose scrub fails', async () => {
    const actual = await vi.importActual<typeof import('@/lib/privacy/scrub')>('@/lib/privacy/scrub');
    vi.mocked(scrubForRecord).mockImplementation(async (text, opts) => {
      if (opts.fileName === 'raw/transcripts/x.md') throw new Error('privacy-scrub guard rejected chunk 1/1: text changed at input token 3');
      return actual.scrubForRecord(text, opts);
    });
    const p = writeAndPush({
      pages: [{ path: 'raw/transcripts/x.md', content: 't' }, { path: 'courses/ok.md', content: 'ok' }],
      logEntry: 'entry',
      commitMessage: 'msg',
    });
    const err = (await p.catch(e => e as WikiPagesWithheldError)) as WikiPagesWithheldError;
    expect(err).toBeInstanceOf(WikiPagesWithheldError);
    expect(err.withheld.map(w => w.path)).toEqual(['raw/transcripts/x.md']);
    expect(writtenPaths()).toContain(path.join(REPO, 'courses/ok.md'));
  });

  it('scrubs emails out of the log entry and the commit message', async () => {
    await writeAndPush({
      pages: [{ path: 'courses/a.md', content: 'a' }],
      logEntry: 'ingest — by prof@clemson.edu',
      commitMessage: 'feat: snapshot (prof@clemson.edu)',
    });
    expect(mockAppendFile()).toHaveBeenCalledWith(path.join(REPO, 'log.md'), '\ningest — by [email]\n');
    expect(gitArgs()).toContain(`-C ${REPO} commit -m feat: snapshot ([email])`);
  });
});
