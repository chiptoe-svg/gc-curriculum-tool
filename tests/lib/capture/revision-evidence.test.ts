import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CaptureProfile, CaptureProfileCitationType } from '@/lib/ai/capture/schema';
import { createInMemoryVectorStore, tenantForCourse, type VectorStore } from '@/lib/capture/vector-store';
import { hashText } from '@/lib/capture/text-hash';

const mockGetSessionMessages = vi.fn();
vi.mock('@/lib/db/capture-messages-queries', () => ({
  getSessionMessages: (...a: unknown[]) => mockGetSessionMessages(...a),
}));

import { buildCitationClassifiers } from '@/lib/capture/revision-evidence';

const CODE = 'GC 4800';
const SESSION = 'cccccccc-0000-4000-8000-000000000009';
const THIS_MSG = 'aaaaaaaa-1111-4000-8000-000000000001';
const OLD_MSG = 'bbbbbbbb-2222-4000-8000-000000000002';

const material = (id: string, over: Record<string, unknown> = {}) => ({
  id, fileName: `${id}.pdf`, extractionStatus: 'ok', sizeBytes: 10, ignored: false, retiredAt: null, extractedText: `text of ${id}`, ...over,
}) as never;
const frozen = (id: string, over: Record<string, unknown> = {}) => ({
  id, fileName: `${id}.pdf`, extractionStatus: 'ok', sizeBytes: 10, ignored: false, textHash: hashText(`text of ${id}`), ...over,
});
const baseline = (frozenMaterials: unknown[]) => ({
  id: 'snap-1',
  profile: { competencies: [] } as unknown as CaptureProfile,
  inputsMeta: { materials: frozenMaterials, scanPasses: { canvasImportedAt: null, googleDocsScannedAt: null } },
}) as never;
const scoredCiting = (citations: CaptureProfileCitationType[]) =>
  ({ competencies: [{ statement: 'A', citations }] }) as unknown as CaptureProfile;
const chunk = (chunkId: string): CaptureProfileCitationType => ({ type: 'chunk', chunkId, excerpt: 'x' });
const said = (messageId: string): CaptureProfileCitationType => ({ type: 'instructor', messageId, excerpt: 'x' });

async function seed(store: VectorStore, chunkId: string, materialId: string) {
  await store.upsert(tenantForCourse(CODE), [{
    id: chunkId, vector: [1], materialId, courseCode: CODE, fileName: 'f', sectionTitle: 's',
    sectionIndex: 0, parentSectionId: 'p', text: 't', contextBlurb: '',
  }]);
}

async function classify(opts: { citations: CaptureProfileCitationType[]; frozen: unknown[]; live: unknown[]; store: VectorStore }) {
  return buildCitationClassifiers({
    courseCode: CODE, sessionId: SESSION, baseline: baseline(opts.frozen), materials: opts.live as never,
    course: { canvasImportedAt: null }, scored: scoredCiting(opts.citations), store: opts.store,
  });
}

describe('buildCitationClassifiers', () => {
  beforeEach(() => {
    mockGetSessionMessages.mockReset();
    mockGetSessionMessages.mockResolvedValue([{ id: THIS_MSG, role: 'user' }]);
  });

  it('instructor citation from this session is new (full id and 8-char prefix)', async () => {
    const store = createInMemoryVectorStore();
    const c = await classify({ citations: [], frozen: [], live: [], store });
    expect(c.isNewCitation(said(THIS_MSG))).toBe(true);
    expect(c.isNewCitation(said(THIS_MSG.slice(0, 8)))).toBe(true);
    expect(mockGetSessionMessages).toHaveBeenCalledWith(CODE, SESSION);
  });

  it('instructor citation from an older session is not new', async () => {
    const c = await classify({ citations: [], frozen: [], live: [], store: createInMemoryVectorStore() });
    expect(c.isNewCitation(said(OLD_MSG))).toBe(false);
    expect(c.isNewCitation(said(OLD_MSG.slice(0, 8)))).toBe(false);
  });

  it('chunk from an added material is new', async () => {
    const store = createInMemoryVectorStore();
    await seed(store, 'c-new', 'm-new');
    const c = await classify({ citations: [chunk('c-new')], frozen: [frozen('m-old')], live: [material('m-old'), material('m-new')], store });
    expect(c.isNewCitation(chunk('c-new'))).toBe(true);
    expect(c.isStaleCitation(chunk('c-new'))).toBe(false);
  });

  it('chunk from a re-imported material is new', async () => {
    const store = createInMemoryVectorStore();
    await seed(store, 'c1', 'm1');
    const c = await classify({ citations: [chunk('c1')], frozen: [frozen('m1')], live: [material('m1', { extractedText: 'edited text' })], store });
    expect(c.isNewCitation(chunk('c1'))).toBe(true);
  });

  it('chunk from an unchanged material is not new', async () => {
    const store = createInMemoryVectorStore();
    await seed(store, 'c1', 'm1');
    const c = await classify({ citations: [chunk('c1')], frozen: [frozen('m1')], live: [material('m1')], store });
    expect(c.isNewCitation(chunk('c1'))).toBe(false);
    expect(c.isStaleCitation(chunk('c1'))).toBe(false);
  });

  it('chunk from a retired material is stale', async () => {
    const store = createInMemoryVectorStore();
    await seed(store, 'c1', 'm1');
    const c = await classify({ citations: [chunk('c1')], frozen: [frozen('m1')], live: [material('m1', { retiredAt: new Date('2026-11-01') })], store });
    expect(c.isStaleCitation(chunk('c1'))).toBe(true);
    expect(c.isNewCitation(chunk('c1'))).toBe(false);
  });

  it('chunk from a set-aside material is stale', async () => {
    const store = createInMemoryVectorStore();
    await seed(store, 'c1', 'm1');
    const c = await classify({ citations: [chunk('c1')], frozen: [frozen('m1')], live: [material('m1', { ignored: true })], store });
    expect(c.isStaleCitation(chunk('c1'))).toBe(true);
  });

  it('missing chunk is stale and not new', async () => {
    const c = await classify({ citations: [chunk('gone')], frozen: [], live: [], store: createInMemoryVectorStore() });
    expect(c.isStaleCitation(chunk('gone'))).toBe(true);
    expect(c.isNewCitation(chunk('gone'))).toBe(false);
  });

  it('each chunk id is looked up once, across scored and baseline profiles', async () => {
    const store = createInMemoryVectorStore();
    await seed(store, 'c1', 'm1');
    const spy = vi.spyOn(store, 'fetchChunkById');
    const b = baseline([frozen('m1')]) as { profile: CaptureProfile };
    b.profile = scoredCiting([chunk('c1')]);
    const c = await buildCitationClassifiers({
      courseCode: CODE, sessionId: SESSION, baseline: b as never, materials: [material('m1')] as never,
      course: { canvasImportedAt: null }, scored: scoredCiting([chunk('c1'), chunk('c1')]), store,
    });
    c.isNewCitation(chunk('c1')); c.isStaleCitation(chunk('c1'));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
