/**
 * Tests for lib/capture/render-pages.ts
 *
 * Orchestration is tested via vi.spyOn on the namespace imports used by the
 * module under test (childProcess.spawn, nodeFsPromises.*).  This mirrors the
 * approach proven in lib/wiki/__tests__/git-ops.test.ts which spies on
 * `* as childProcess` and `* as nodeFs` imports — the only reliable way to
 * intercept spawn calls from a Vitest jsdom test.
 *
 * One real end-to-end smoke test verifies actual pdftoppm rendering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock node:child_process and node:fs/promises via vi.mock with importOriginal
// so the namespace object is replaceable by vi.spyOn at call time.
//
// NOTE: vi.mock factories are hoisted above imports. The mocked namespace is
// what render-pages.ts sees for `* as childProcess` / `* as nodeFsPromises`.
// ---------------------------------------------------------------------------

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual };
});

// ---------------------------------------------------------------------------
// Import the mocked namespaces AND the module under test after vi.mock.
// ---------------------------------------------------------------------------

import * as childProcess from 'node:child_process';
import * as nodeFsPromises from 'node:fs/promises';

import { renderToImages } from '@/lib/capture/render-pages';

// ---------------------------------------------------------------------------
// Spawn mock helpers
// ---------------------------------------------------------------------------

interface SpawnCall {
  cmd: string;
  args: string[];
}
const spawnCalls: SpawnCall[] = [];

function makeMockProc(exitCode: number = 0, errorOnSpawn?: Error) {
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
  const proc = {
    stdout: { on: (_: string, __: unknown) => proc },
    stderr: {
      on: (_: string, __: unknown) => proc,
    },
    on(event: string, cb: (...a: unknown[]) => void) {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
      return proc;
    },
    emit(event: string, ...args: unknown[]) {
      (listeners[event] ?? []).forEach(cb => cb(...args));
    },
    kill: vi.fn(),
  };
  if (errorOnSpawn) {
    setTimeout(() => proc.emit('error', errorOnSpawn), 0);
  } else {
    setTimeout(() => proc.emit('close', exitCode), 0);
  }
  return proc;
}

let spawnMockImpl: () => ReturnType<typeof makeMockProc> = () => makeMockProc(0);

// ---------------------------------------------------------------------------
// Setup & teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  spawnCalls.length = 0;
  spawnMockImpl = () => makeMockProc(0);

  // Spy on spawn — intercepts childProcess.spawn() calls in render-pages.ts
  vi.spyOn(childProcess, 'spawn').mockImplementation(
    (cmd: string, args: readonly string[] | string[], _opts?: unknown) => {
      spawnCalls.push({ cmd, args: Array.from(args) });
      return spawnMockImpl() as unknown as ReturnType<typeof childProcess.spawn>;
    },
  );

  // Default fs spies — success path
  vi.spyOn(nodeFsPromises, 'mkdtemp').mockResolvedValue('/tmp/render-test-XXXXXX');
  vi.spyOn(nodeFsPromises, 'writeFile').mockResolvedValue(undefined);
  vi.spyOn(nodeFsPromises, 'readdir').mockResolvedValue(
    ['page-1.png', 'page-2.png', 'page-3.png'] as unknown as Awaited<ReturnType<typeof nodeFsPromises.readdir>>,
  );
  vi.spyOn(nodeFsPromises, 'readFile').mockImplementation((p) => {
    const m = String(p).match(/(\d+)\.png$/);
    const n = m ? parseInt(m[1]!, 10) : 1;
    return Promise.resolve(Buffer.alloc(n)) as ReturnType<typeof nodeFsPromises.readFile>;
  });
  vi.spyOn(nodeFsPromises, 'rm').mockResolvedValue(undefined);
  vi.spyOn(nodeFsPromises, 'mkdir').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastSpawnCmds() {
  return spawnCalls.map(c => c.cmd);
}

function spawnCallFor(fragment: string) {
  return spawnCalls.find(c => c.cmd.includes(fragment));
}

// ---------------------------------------------------------------------------
// Unsupported MIME
// ---------------------------------------------------------------------------

describe('renderToImages — unsupported MIME', () => {
  it('returns [] for text/plain without any shell-out', async () => {
    const result = await renderToImages(Buffer.from('hello'), 'text/plain', 'readme.txt');
    expect(result).toEqual([]);
    expect(spawnCalls).toHaveLength(0);
  });

  it('returns [] for image/jpeg without any shell-out', async () => {
    const result = await renderToImages(Buffer.from(''), 'image/jpeg', 'photo.jpg');
    expect(result).toEqual([]);
    expect(spawnCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PDF path
// ---------------------------------------------------------------------------

describe('renderToImages — application/pdf', () => {
  it('invokes pdftoppm with -png, -r, 200 and does NOT invoke soffice', async () => {
    const result = await renderToImages(Buffer.from('%PDF'), 'application/pdf', 'deck.pdf');

    // Should get 3 pages from mock readdir
    expect(result).toHaveLength(3);

    // Only pdftoppm should have been spawned
    expect(lastSpawnCmds().some(c => c.includes('pdftoppm'))).toBe(true);
    expect(lastSpawnCmds().some(c => c.includes('soffice'))).toBe(false);

    // Verify pdftoppm args contain -png, -r, 200 (raised from 150 so canonicalize
    // only downscales — see lib/ai/vision-canonicalize.ts).
    const pdfCall = spawnCallFor('pdftoppm')!;
    expect(pdfCall).toBeDefined();
    expect(pdfCall.args).toContain('-png');
    expect(pdfCall.args).toContain('-r');
    expect(pdfCall.args).toContain('200');
  });
});

// ---------------------------------------------------------------------------
// PPTX / slide paths
// ---------------------------------------------------------------------------

describe('renderToImages — PPTX', () => {
  it('invokes soffice --convert-to pdf THEN pdftoppm for PPTX mime', async () => {
    // First readdir call = scan for PDF output after soffice → ['input.pdf']
    // Second readdir call = scan for page PNGs after pdftoppm → ['page-1.png', 'page-2.png']
    let readdirCall = 0;
    vi.spyOn(nodeFsPromises, 'readdir').mockImplementation(() => {
      readdirCall++;
      const files = readdirCall === 1
        ? ['input.pdf']
        : ['page-1.png', 'page-2.png'];
      return Promise.resolve(files as unknown as Awaited<ReturnType<typeof nodeFsPromises.readdir>>);
    });

    const result = await renderToImages(
      Buffer.from('PK'),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'lecture.pptx',
    );

    expect(result).toHaveLength(2);

    expect(lastSpawnCmds().some(c => c.includes('soffice'))).toBe(true);
    expect(lastSpawnCmds().some(c => c.includes('pdftoppm'))).toBe(true);

    // soffice first, pdftoppm second
    const sofficeCall = spawnCallFor('soffice')!;
    expect(sofficeCall).toBeDefined();
    expect(sofficeCall.args).toContain('--convert-to');
    expect(sofficeCall.args).toContain('pdf');

    const pdfCall = spawnCallFor('pdftoppm')!;
    expect(pdfCall).toBeDefined();
  });

  it('invokes soffice for legacy .ppt mime', async () => {
    let readdirCall = 0;
    vi.spyOn(nodeFsPromises, 'readdir').mockImplementation(() => {
      readdirCall++;
      const files = readdirCall === 1 ? ['input.pdf'] : ['page-1.png'];
      return Promise.resolve(files as unknown as Awaited<ReturnType<typeof nodeFsPromises.readdir>>);
    });

    await renderToImages(Buffer.from('PK'), 'application/vnd.ms-powerpoint', 'old-deck.ppt');
    expect(lastSpawnCmds().some(c => c.includes('soffice'))).toBe(true);
  });

  it('invokes soffice for Keynote mime', async () => {
    let readdirCall = 0;
    vi.spyOn(nodeFsPromises, 'readdir').mockImplementation(() => {
      readdirCall++;
      const files = readdirCall === 1 ? ['input.pdf'] : ['page-1.png'];
      return Promise.resolve(files as unknown as Awaited<ReturnType<typeof nodeFsPromises.readdir>>);
    });

    await renderToImages(Buffer.from('PK'), 'application/vnd.apple.keynote', 'slides.key');
    expect(lastSpawnCmds().some(c => c.includes('soffice'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('renderToImages — error handling', () => {
  it('returns [] (no throw) when pdftoppm exits non-zero', async () => {
    spawnMockImpl = () => makeMockProc(1);
    const result = await renderToImages(Buffer.from('%PDF'), 'application/pdf', 'broken.pdf');
    expect(result).toEqual([]);
  });

  it('returns [] (no throw) when spawn emits an error event', async () => {
    spawnMockImpl = () => makeMockProc(0, new Error('ENOENT: binary not found'));
    const result = await renderToImages(Buffer.from('%PDF'), 'application/pdf', 'missing.pdf');
    expect(result).toEqual([]);
  });

  it('returns [] (no throw) when soffice fails in the PPTX path', async () => {
    spawnMockImpl = () => makeMockProc(1); // soffice exits 1
    const result = await renderToImages(
      Buffer.from('PK'),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'bad.pptx',
    );
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 60-page cap
// ---------------------------------------------------------------------------

describe('renderToImages — 60-page cap', () => {
  it('caps at MAX_SLIDES=60 and logs a warning when more pages exist', async () => {
    const manyPages = Array.from({ length: 65 }, (_, i) => `page-${i + 1}.png`);
    vi.spyOn(nodeFsPromises, 'readdir').mockResolvedValue(
      manyPages as unknown as Awaited<ReturnType<typeof nodeFsPromises.readdir>>,
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await renderToImages(Buffer.from('%PDF'), 'application/pdf', 'big.pdf');

    expect(result).toHaveLength(60);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[render-pages] capped at 60 pages'),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('big.pdf'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('65'));

    warnSpy.mockRestore();
  });

  it('does not warn when page count is exactly 60', async () => {
    const pages = Array.from({ length: 60 }, (_, i) => `page-${i + 1}.png`);
    vi.spyOn(nodeFsPromises, 'readdir').mockResolvedValue(
      pages as unknown as Awaited<ReturnType<typeof nodeFsPromises.readdir>>,
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await renderToImages(Buffer.from('%PDF'), 'application/pdf', 'exactly60.pdf');
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Real end-to-end smoke test
// Uses real fs/childProcess calls (not the mocked namespace objects) via
// the native Node.js APIs imported separately, bypassing vi.spyOn.
// ---------------------------------------------------------------------------

describe('renderToImages — real render smoke test', () => {
  it('renders a real 1-page PDF to at least 1 PNG Buffer using actual pdftoppm', async () => {
    // Minimal hand-crafted 1-page PDF — no external file, no network needed.
    const pdfContent = [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj',
      'xref',
      '0 4',
      '0000000000 65535 f ',
      '0000000009 00000 n ',
      '0000000058 00000 n ',
      '0000000115 00000 n ',
      'trailer<</Size 4/Root 1 0 R>>',
      'startxref',
      '190',
      '%%EOF',
    ].join('\n');

    // Restore all spies so real fs/spawn calls go through.
    vi.restoreAllMocks();

    // Now use real fs + real pdftoppm directly (not via the module under test,
    // since the module's mocked imports are restored but the test's own dynamic
    // imports go through the live Node.js module system).
    const { execFile } = await import('node:child_process');
    const { mkdtemp, writeFile, readdir: realReaddir, readFile: realReadFile, rm } =
      await import('node:fs/promises');
    const { tmpdir: realTmpdir } = await import('node:os');
    const { join: realJoin } = await import('node:path');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    const dir = await mkdtemp(realJoin(realTmpdir(), 'render-smoke-'));
    try {
      const pdfPath = realJoin(dir, 'test.pdf');
      await writeFile(pdfPath, Buffer.from(pdfContent, 'ascii'));

      await execFileAsync(
        '/opt/homebrew/bin/pdftoppm',
        ['-png', '-r', '72', pdfPath, realJoin(dir, 'page')],
      );

      const files = (await realReaddir(dir)).filter(
        f => f.startsWith('page') && f.endsWith('.png'),
      );
      expect(files.length).toBeGreaterThanOrEqual(1);

      const buffers = await Promise.all(
        files.map(f => realReadFile(realJoin(dir, f))),
      );
      for (const buf of buffers) {
        expect(buf.length).toBeGreaterThan(0);
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);
});
