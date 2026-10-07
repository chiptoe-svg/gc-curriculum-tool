/**
 * Owner, 2026-10-07: no FERPA notices anywhere in capture. Emails, SSNs and
 * CU IDs are scrubbed before storage, and the OpenAI contract allows FERPA
 * data, so the warnings only added noise.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import type { CaptureMaterial, CourseCatalogView } from '@/app/capture/[code]/MaterialsPanel';

vi.mock('@/components/CanvasImportZone', () => ({ CanvasImportZone: () => null }));
vi.mock('@/lib/capture/fetch-course-materials', () => ({ fetchCourseMaterials: vi.fn() }));
vi.mock('@/lib/ai/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/provider')>('@/lib/ai/provider');
  return { ...actual, getProviderForFunction: vi.fn() };
});

import { MaterialsPanel } from '@/app/capture/[code]/MaterialsPanel';
import { MaterialGate } from '@/app/capture/[code]/MaterialGate';
import { generateIngestionCheckIn } from '@/lib/ai/analyze/ingestion-checkin';
import { getProviderForFunction } from '@/lib/ai/provider';

const course: CourseCatalogView = {
  code: 'GC 1010', title: 'Intro', description: '', prerequisites: '',
  learningObjectives: [], majorProjects: [], skillsRequired: [], auditMode: 'full',
  canvasCourseName: null, canvasImportedAt: null, pairedCodes: [],
};

const material = {
  id: 'm1', fileName: 'GC1010_wrapup.pdf', mimeType: 'application/pdf', sizeBytes: 1024,
  pageCount: null, extractionStatus: 'ok', extractionMethod: null, extractedText: 'hello',
  ignored: false, digest: null, digestGeneratedAt: null, useDigest: false,
  indexingStatus: 'ready', indexedAt: null, ferpaRisk: 'medium', autoSetAside: false,
  setAsideReason: null, blobUrl: '', sourceCode: null,
} as unknown as CaptureMaterial;

describe('no FERPA notices', () => {
  it('a medium-risk material shows no FERPA badge', () => {
    render(<MaterialsPanel course={course} initialMaterials={[material]} slug="s" initiallyExpanded hideRows={false} />);
    expect(screen.getByText('GC1010_wrapup.pdf')).toBeTruthy();
    expect(screen.queryByText(/FERPA|Student names/i)).toBeNull();
  });

  it('the pre-interview gate labels automatic set-asides without FERPA', () => {
    render(
      <MaterialGate
        flags={[{ id: 'b', fileName: 'Tumbler.pdf', kind: 'set-aside', facultyNote: null }]}
        onContinue={() => {}}
        onBack={() => {}}
      />,
    );
    expect(screen.getByText(/set aside automatically/i)).toBeTruthy();
    expect(screen.queryByText(/FERPA/i)).toBeNull();
  });

  it('the check-in never sends FERPA risk or allows a FERPA highlight', async () => {
    const complete = vi.fn(async (args: { validate: (raw: unknown) => unknown }) => ({
      data: args.validate({ message: null, highlights: [] }),
      costUsdCents: 0, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 1, completionTokens: 1,
    }));
    vi.mocked(getProviderForFunction).mockResolvedValueOnce({ name: 'fake', model: 'm', complete } as never);
    await generateIngestionCheckIn({
      catalog: { code: 'GC 1010', title: 'Intro', learningObjectives: [], majorProjects: [] },
      materials: [{ fileName: 'a.pdf', autoSetAside: false, setAsideReason: null, digestSnippet: 'x' }],
      context: { catalogCoversSyllabus: true, hasCanvasAssignments: true, canvasSyllabusSetAside: false },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (complete.mock.calls as any)[0][0];
    expect(arg.systemPrompt).not.toMatch(/FERPA/i);
    expect(JSON.stringify(arg.jsonSchema)).not.toMatch(/ferpa/i);
  });

  it('the check-in route no longer sends FERPA risk', () => {
    const src = readFileSync('app/api/courses/[code]/checkin/route.ts', 'utf8');
    expect(src).not.toMatch(/ferpaRisk/);
  });
});
