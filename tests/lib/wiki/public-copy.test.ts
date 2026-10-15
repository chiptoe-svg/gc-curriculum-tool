import { describe, it, expect } from 'vitest';
import { publicCopyUrl, sendToPublicCopy, PUBLIC_WIKI_COPY, SNAPSHOT_HEADER } from '@/lib/wiki/public-copy';

describe('publicCopyUrl', () => {
  it('maps the wiki index to the copy root', () => {
    expect(publicCopyUrl('/wiki')).toBe(PUBLIC_WIKI_COPY);
    expect(publicCopyUrl('/wiki/')).toBe(PUBLIC_WIKI_COPY);
  });
  it('maps a page to its folder in the copy', () => {
    expect(publicCopyUrl('/wiki/courses/gc-1010')).toBe(`${PUBLIC_WIKI_COPY}courses/gc-1010/`);
    expect(publicCopyUrl('/wiki/guide')).toBe(`${PUBLIC_WIKI_COPY}guide/`);
  });
});

describe('sendToPublicCopy', () => {
  it('sends public visitors to the copy', () => {
    expect(sendToPublicCopy(false, new Headers())).toBe(true);
  });
  it('keeps faculty on the live pages', () => {
    expect(sendToPublicCopy(true, new Headers())).toBe(false);
  });
  it('lets the snapshot crawler read the live pages', () => {
    expect(sendToPublicCopy(false, new Headers({ [SNAPSHOT_HEADER]: '1' }))).toBe(false);
  });
});
