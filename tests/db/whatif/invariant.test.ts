// @vitest-environment node
// The what-if invariant: a full what-if (start, two turns, an attachment, a quick estimate, create page,
// update page, rename, delete) leaves every store that describes the real course byte-for-byte unchanged.
// Scratch DB only. Not rolled back: it runs the real routes and cleans up with the delete route and
// deleteWhatIf. The AI calls and text extraction are mocked (no network, no spend). The wiki is a
// temporary clone of a temporary bare copy, so nothing can reach the real wiki repository or its remote;
// storage (the home directory, which sets STORAGE_ROOT) is a temporary directory.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';

const env = await vi.hoisted(async () => {
  // Set before any app module loads: WIKI_REPO_PATH and STORAGE_ROOT (from the home directory) are read at import.
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  let onScratch = false;
  try { onScratch = new URL(process.env.DATABASE_URL ?? '').pathname === '/gc_curriculum_whatif_scratch'; } catch { /* not set */ }
  if (!onScratch) return { root: '', wiki: '' };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whatif-invariant-'));
  const git = (...args: string[]) => execFileSync('git', args, { stdio: 'pipe' });
  git('clone', '--bare', '/Users/admin/projects/gc-curriculum-wiki', path.join(root, 'origin.git'));
  git('clone', path.join(root, 'origin.git'), path.join(root, 'wiki'));
  fs.mkdirSync(path.join(root, 'home'));
  process.env.WIKI_REPO_PATH = path.join(root, 'wiki');
  process.env.HOME = path.join(root, 'home');
  process.env.VECTOR_STORE = 'in-memory';
  return { root, wiki: path.join(root, 'wiki') };
});

vi.mock('@/lib/auth/route-auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/route-auth')>()),
  authorizeRequest: async () => ({
    grant: { id: 'test-admin', label: 'Test Admin', scope: ['*'], can: ['read', 'capture', 'create', 'admin'] },
  }),
}));

// One mutable estimate the fake provider hands out; set by the test from the approved profile.
const fake = vi.hoisted(() => ({
  estimate: { changeItems: [], movedRatings: [], newCompetencies: [], incomingChanges: [] } as unknown,
}));
const TELEMETRY = { costUsdCents: 0, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 1, completionTokens: 1 };

vi.mock('@/lib/ai/provider', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/provider')>()),
  getProviderForFunction: async (functionId: string) => ({
    name: 'fake',
    model: `fake-${functionId}`,
    async complete(args: { schemaName: string; validate: (raw: unknown) => unknown }) {
      const raw = args.schemaName === 'what_if_estimate_v1'
        ? fake.estimate
        : {
            description: 'The course adds a short unit on color management for print.',
            whatChanges: 'Students spend two weeks on color management.',
            neighbors: 'Later production courses can build on the new unit.',
            questions: ['Which assignment gives way?', 'Who teaches the unit?', 'How is it assessed?'],
            summary: 'Adds a color management unit.',
            title: 'Color management unit',
          };
      return { data: args.validate(raw), ...TELEMETRY };
    },
    async *streamWithTools(args: {
      tools: Array<{ name: string; execute: (a: unknown) => Promise<unknown> }>;
      validate: (raw: unknown) => unknown;
    }) {
      const quick = args.tools.find(t => t.name === 'quick_estimate');
      if (quick) await quick.execute({ candidate: 'Add a two-week color management unit.' });
      yield {
        kind: 'final',
        value: args.validate({ response: 'That sounds workable. What would it replace?', citations: [] }),
        toolCallsUsed: [],
        telemetry: TELEMETRY,
      };
    },
  }),
}));

vi.mock('@/lib/courses/extract-text', async (orig) => ({
  ...(await orig<typeof import('@/lib/courses/extract-text')>()),
  extractText: async () => ({ status: 'ok', method: 'text', text: 'Proposed unit outline: two weeks on ICC profiles and press color targets.', pageCount: 1 }),
}));

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { db } from '@/lib/db/client';
import { courseWhatIfs, courseWhatIfMessages, courseWhatIfAttachments, prerequisiteEdges } from '@/lib/db/schema';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { deleteCaptureConversation, getCaptureConversation, upsertCaptureConversation } from '@/lib/db/capture-conversations-queries';
import { deleteWhatIf, getWhatIf, listActiveSubCompetencies } from '@/lib/db/what-if-queries';
import { courseSlug, STORAGE_ROOT } from '@/lib/storage/local-storage';
import { POST as startWhatIf } from '@/app/api/explore/[code]/what-ifs/route';
import { PATCH as renameRoute, DELETE as deleteRoute } from '@/app/api/explore/[code]/what-ifs/[id]/route';
import { POST as chatRoute } from '@/app/api/explore/[code]/what-ifs/[id]/chat/route';
import { POST as attachRoute } from '@/app/api/explore/[code]/what-ifs/[id]/attachments/route';
import { POST as pageRoute } from '@/app/api/explore/[code]/what-ifs/[id]/page/route';
import { isWhatIfScratchDb } from './scratch-guard';
import { fingerprintRealCourse } from './real-course-fingerprint';

const CODE = 'GC 3730';
const PREREQ_FOR = 'GC 3740'; // a later course that lists GC 3730 as a confirmed prerequisite, for the effects step

afterAll(async () => {
  if (env.root) await fsp.rm(env.root, { recursive: true, force: true });
});

const BASE = 'http://localhost/api/explore/GC%203730/what-ifs';
const ctx = (id: string) => ({ params: Promise.resolve({ code: 'GC%203730', id }) });
const json = (url: string, method: string, body: unknown) =>
  new Request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe.runIf(isWhatIfScratchDb())('what-if invariant (scratch DB)', () => {
  it('a full what-if leaves the real course byte-for-byte unchanged', async () => {
    const slug = courseSlug(CODE);
    expect(STORAGE_ROOT.startsWith(path.join(env.root, 'home'))).toBe(true); // not the real storage directory

    // A file in the course's material directory, so the listing hash is not empty.
    await fsp.mkdir(path.join(STORAGE_ROOT, slug), { recursive: true });
    await fsp.writeFile(path.join(STORAGE_ROOT, slug, 'seed-syllabus.txt'), 'seed');

    const base = await getLatestSnapshotByCourse(CODE);
    expect(base).not.toBeNull();
    const target = base!.profile.competencies.find(c => c.type === 'technical' && c.d_depth !== null && c.d_depth < 5)!;
    expect(target).toBeDefined();
    fake.estimate = {
      changeItems: [{ kind: 'added', description: 'A two-week color management unit.' }],
      movedRatings: [{
        statement: target.statement,
        after: { k: target.k_depth, u: target.u_depth, d: (target.d_depth as number) + 1 },
        confidence: 'medium', reason: 'Students now practice it.',
      }],
      newCompetencies: [],
      incomingChanges: [],
    };

    // A revision in progress: the course's working draft (course_capture_profiles) already exists in the
    // scratch copy and is left as it is; the test adds a saved interview conversation and a confirmed
    // prerequisite edge, and removes both at the end.
    const sub = (await listActiveSubCompetencies())[0]!;
    await upsertCaptureConversation({
      courseCode: CODE, messages: [{ role: 'user', content: 'I want to revise this course.' }], readiness: null,
    });
    const [edge] = await db.insert(prerequisiteEdges).values({
      focalCourseCode: PREREQ_FOR, prereqCourseCode: CODE, subCompetencyId: sub.id,
      expectedK: 1, expectedU: null, expectedD: null, source: 'faculty', confidence: 'high', confirmed: true,
    }).returning({ id: prerequisiteEdges.id });

    let whatIfId: string | null = null;
    let startedId = '';
    try {
      const before = await fingerprintRealCourse(CODE, env.wiki);

      // start
      const started = await startWhatIf(json(BASE, 'POST', { authorName: 'Invariant Test' }), { params: Promise.resolve({ code: 'GC%203730' }) });
      expect(started.status).toBe(201);
      whatIfId = startedId = ((await started.json()) as { id: string }).id;
      const url = `${BASE}/${whatIfId}`;

      // two conversation turns (the first runs a quick estimate)
      for (const message of ['What if we add a color management unit?', 'It would replace one print lab.']) {
        const res = await chatRoute(json(`${url}/chat`, 'POST', { message }), ctx(whatIfId));
        expect(res.status).toBe(200);
        await res.text(); // the turn is stored when the stream ends
      }

      // one attachment
      const form = new FormData();
      form.set('file', new File([Buffer.from('%PDF-1.4 outline')], 'unit-outline.pdf', { type: 'application/pdf' }));
      const attached = await attachRoute(new Request(`${url}/attachments`, { method: 'POST', body: form }), ctx(whatIfId));
      expect(attached.status).toBe(201);

      // create the page, update it, rename
      expect((await pageRoute(json(`${url}/page`, 'POST', {}), ctx(whatIfId))).status).toBe(200);
      expect((await pageRoute(json(`${url}/page`, 'POST', {}), ctx(whatIfId))).status).toBe(200);
      expect((await renameRoute(json(url, 'PATCH', { title: 'Renamed what-if' }), ctx(whatIfId))).status).toBe(200);

      // the what-if really did something: two turns, a quick estimate card, an attachment, a page
      const row = (await getWhatIf(whatIfId))!;
      expect(row.pageCreatedAt).not.toBeNull();
      expect(row.title).toBe('Renamed what-if');
      expect((await db.select().from(courseWhatIfMessages).where(eq(courseWhatIfMessages.whatIfId, whatIfId))).length).toBe(4);
      expect((await db.select().from(courseWhatIfAttachments).where(eq(courseWhatIfAttachments.whatIfId, whatIfId))).length).toBe(1);

      // delete (removes the attachment file too)
      expect((await deleteRoute(new Request(url, { method: 'DELETE' }), ctx(whatIfId))).status).toBe(204);
      whatIfId = null;

      const after = await fingerprintRealCourse(CODE, env.wiki);
      expect(after).toEqual(before);
    } finally {
      if (whatIfId) await deleteWhatIf(whatIfId);
      await deleteCaptureConversation(CODE);
      await db.delete(prerequisiteEdges).where(eq(prerequisiteEdges.id, edge!.id));
    }

    // clean-up: nothing left of the what-if, nothing left of what the test inserted
    expect(await db.select().from(courseWhatIfs).where(eq(courseWhatIfs.courseCode, CODE))).toEqual([]);
    expect(await db.select().from(courseWhatIfMessages).where(eq(courseWhatIfMessages.whatIfId, startedId))).toEqual([]);
    expect(await db.select().from(courseWhatIfAttachments).where(eq(courseWhatIfAttachments.whatIfId, startedId))).toEqual([]);
    expect(await getCaptureConversation(CODE)).toBeNull();
  }, 120_000);
});
