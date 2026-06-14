import { describe, it, expect, vi } from 'vitest';

const SNAP = { id: 'snap-1', createdAt: new Date('2026-06-14T00:00:00.000Z'), instructorName: 'Dr. X', profile: {
  course_code: 'GC 4800', scale_version: 'v1', generated_at: 'now',
  overview: { narrative: 'Cap.' }, competencies: [{ statement: 'Color', type: 'technical', k_depth: 3, u_depth: 3, d_depth: 4, evidence_d: 'e', source: 'materials' }],
  incoming_expectations: [], verification_summary: { course_shape: 's', strongest_evidence: ['x'], dimensional_patterns: [], catalog_vs_evidence: [] },
  audit_notes: {}, revised_objectives_draft: ['Outcome'], course_emphasis: null,
} };

vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: async (code: string) => code === 'GC 4800' ? { code: 'GC 4800', title: 'Capstone', prefix: 'GC', level: 4, track: 'print', buildsToCareer: true, catalogUrl: null } : null }));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getLatestSnapshotByCourse: async (code: string) => code === 'GC 4800' ? SNAP : null }));
vi.mock('@/lib/capture/redact-pii', () => ({ redactPiiDeep: (x: unknown) => x }));

import { GET } from '@/app/view/[code]/okf/route';

const ctx = (code: string) => ({ params: Promise.resolve({ code }) });

describe('GET /view/[code]/okf', () => {
  it('returns text/markdown attachment for a captured course', async () => {
    const res = await GET(new Request('http://host/view/GC%204800/okf'), ctx('GC%204800'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="gc-4800.md"/);
    const body = await res.text();
    expect(body).toMatch(/^type: course$/m);
    expect(body).toContain('## Apparent outcomes');
  });
  it('404s when no captured profile exists', async () => {
    const res = await GET(new Request('http://host/view/GC%209999/okf'), ctx('GC%209999'));
    expect(res.status).toBe(404);
  });
});
