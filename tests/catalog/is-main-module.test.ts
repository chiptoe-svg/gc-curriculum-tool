/**
 * Both catalog sync scripts' `main()` guard used to compare
 * `import.meta.url` (which Node resolves to the REAL path when loading the
 * entry module) against the literal `process.argv[1]` (which keeps
 * whatever path the script was invoked with). Invoking either script
 * through a symlink made the comparison fail silently — `--apply` printed
 * nothing and exited 0, which looks like success (fix round 2, N4).
 *
 * `isMainModule` fixes this by comparing REALPATHS on both sides. Tested
 * against real temp files + a real symlink (no mocking needed — this is
 * exactly what a symlinked invocation looks like).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMainModule } from '@/scripts/catalog/catalog-source';

let dir: string;
let realFile: string;
let linkFile: string;
let otherFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'is-main-module-test-'));
  realFile = join(dir, 'real-script.ts');
  linkFile = join(dir, 'link-script.ts');
  otherFile = join(dir, 'other-script.ts');
  writeFileSync(realFile, '// fixture\n');
  writeFileSync(otherFile, '// fixture\n');
  symlinkSync(realFile, linkFile);
});

afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('isMainModule', () => {
  it('is true when argv[1] is the exact same path as the module URL', () => {
    expect(isMainModule(`file://${realFile}`, realFile)).toBe(true);
  });

  it('is true when argv[1] is a SYMLINK to the real module path (the N4 bug)', () => {
    // Simulates `tsx <symlink-path>/script.ts`: Node resolves import.meta.url
    // to the real path, but argv[1] is still the symlink path the user typed.
    expect(isMainModule(`file://${realFile}`, linkFile)).toBe(true);
  });

  it('is false for an unrelated file', () => {
    expect(isMainModule(`file://${realFile}`, otherFile)).toBe(false);
  });

  it('is false (fails closed) when argv[1] is undefined or a nonexistent path', () => {
    expect(isMainModule(`file://${realFile}`, undefined)).toBe(false);
    expect(isMainModule(`file://${realFile}`, join(dir, 'does-not-exist.ts'))).toBe(false);
  });
});
