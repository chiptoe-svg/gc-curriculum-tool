import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CaptureMaterial, CourseCatalogView } from '@/app/capture/[code]/MaterialsPanel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { MaterialsPanel } from '@/app/capture/[code]/MaterialsPanel';

const course = { code: 'GC 3800', title: 'Junior Seminar', description: 'A course', prerequisites: '', learningObjectives: ['x', 'y'], majorProjects: [], skillsRequired: [], auditMode: 'full' } as unknown as CourseCatalogView;
function mat(o: Partial<CaptureMaterial>): CaptureMaterial {
  return { id: 'm', fileName: 'f.pdf', mimeType: 'application/pdf', sizeBytes: 1, pageCount: null, extractionStatus: 'ok', extractionMethod: null, extractedText: 'x', ignored: false, digest: null, digestGeneratedAt: null, useDigest: false, indexingStatus: 'ready', indexedAt: null, ferpaRisk: 'low', autoSetAside: false, setAsideReason: null, blobUrl: '', sourceCode: null, tier: null, rawCleared: false, retiredAt: null, ...o } as CaptureMaterial;
}

describe('MaterialsPanel — added during the interview', () => {
  it('labels a row with addedInSession, and only that row', () => {
    render(<MaterialsPanel course={course} slug="s" initiallyExpanded initialMaterials={[
      mat({ id: 'a', fileName: 'added.pdf', addedInSession: 'sess-1' }),
      mat({ id: 'b', fileName: 'plain.pdf', addedInSession: null }),
    ]} />);
    expect(screen.getAllByText('Added during the interview')).toHaveLength(1);
  });
});
