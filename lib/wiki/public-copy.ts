/**
 * The public wiki's home is a static copy on the owner's Clemson web space
 * (owner, 2026-10-15): reachable off campus, unlike this app. Public visitors
 * to /wiki are sent there; faculty (a valid ?slug) keep the live pages here.
 *
 * The copy is built by scripts/wiki/snapshot-public.mjs, which crawls these
 * pages and sends SNAPSHOT_HEADER so it is not itself redirected. The header
 * only unlocks the same public pages, so it needs no secret.
 */
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const PUBLIC_WIKI_COPY = 'https://tonkin.people.clemson.edu/pages/gc-wiki/';
export const SNAPSHOT_HEADER = 'x-gc-wiki-snapshot';

/** /wiki -> copy root; /wiki/courses/gc-1010 -> copy/courses/gc-1010/ */
export function publicCopyUrl(wikiPath: string): string {
  const rest = wikiPath.replace(/^\/wiki\/?/, '').replace(/\/$/, '');
  return PUBLIC_WIKI_COPY + (rest ? `${rest}/` : '');
}

/** Send this request to the public copy? Never for faculty or the snapshot crawler. */
export function sendToPublicCopy(faculty: boolean, headers: Headers): boolean {
  return !faculty && headers.get(SNAPSHOT_HEADER) !== '1';
}

/**
 * Ask for a refresh of the Clemson copies. The app only touches a trigger file;
 * launchd (com.gc.clemson-publish, WatchPaths) runs the refresh under /bin/bash,
 * which holds the network-volume permission the app's node process lacks.
 * Never throws: a missed trigger is caught by the nightly run.
 */
export async function requestPublicCopyRefresh(): Promise<void> {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return; // never fire a real publish from tests
  const file = path.join(os.homedir(), '.local/state/gc-curriculum-tool/clemson-refresh.trigger');
  try {
    await writeFile(file, `${new Date().toISOString()}\n`);
  } catch (err) {
    console.error(`[wiki public copy] refresh trigger not written: ${err instanceof Error ? err.message : String(err)}`);
  }
}
