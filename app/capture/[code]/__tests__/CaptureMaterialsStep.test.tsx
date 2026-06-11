import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CaptureMaterial, CourseCatalogView } from '@/app/capture/[code]/MaterialsPanel';

vi.mock('@/app/capture/[code]/MaterialsPanel', () => ({
  MaterialsPanel: () => <div data-testid="materials-panel-detail">detail panel</div>,
  IndexingStatusDot: () => <span data-testid="status-dot" />,
}));

import { CaptureMaterialsStep } from '@/app/capture/[code]/CaptureMaterialsStep';

const course = { code: 'GC 3800', title: 'Junior Seminar', description: '', prerequisites: '', learningObjectives: [], majorProjects: [], skillsRequired: [], auditMode: 'full' } as unknown as CourseCatalogView;

function mat(over: Partial<CaptureMaterial>): CaptureMaterial {
  return {
    id: over.id ?? 'm1', fileName: over.fileName ?? 'x.pdf', mimeType: 'application/pdf',
    sizeBytes: 1, pageCount: null, extractionStatus: 'ok', extractionMethod: null, extractedText: 'x',
    ignored: false, digest: null, digestGeneratedAt: null, useDigest: false,
    indexingStatus: over.indexingStatus ?? 'ready', indexedAt: null, ferpaRisk: 'ok' as never,
    autoSetAside: false, setAsideReason: null, blobUrl: over.blobUrl ?? '', ignoredItems: undefined,
    ...over,
  } as CaptureMaterial;
}

const noop = () => {};

describe('CaptureMaterialsStep', () => {
  it('lists each material with a provenance label', () => {
    const materials = [mat({ id: 'a', fileName: 'Canvas: Syllabus' }), mat({ id: 'b', fileName: 'Project2_Brief.docx' })];
    render(<CaptureMaterialsStep course={course} materials={materials} slug="s" onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    expect(screen.getByText('Canvas: Syllabus')).toBeTruthy();
    expect(screen.getByText('Project2_Brief.docx')).toBeTruthy();
    expect(screen.getByText('Canvas')).toBeTruthy();
    expect(screen.getByText('uploaded')).toBeTruthy();
  });

  it('Continue calls onContinue when materials exist', () => {
    const onContinue = vi.fn();
    render(<CaptureMaterialsStep course={course} materials={[mat({})]} slug="s" onMaterialsChange={noop} onCourseChange={noop} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: /continue to interview/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('shows the empty-guard with a "start anyway" action when there are no materials', () => {
    const onContinue = vi.fn();
    render(<CaptureMaterialsStep course={course} materials={[]} slug="s" onMaterialsChange={noop} onCourseChange={noop} onContinue={onContinue} />);
    expect(screen.queryByRole('button', { name: /continue to interview/i })).toBeNull();
    fireEvent.click(screen.getByText(/start without materials anyway/i));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('reveals the detail MaterialsPanel when "Add a material" is clicked', () => {
    render(<CaptureMaterialsStep course={course} materials={[mat({})]} slug="s" onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    expect(screen.queryByTestId('materials-panel-detail')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /add a material/i }));
    expect(screen.getByTestId('materials-panel-detail')).toBeTruthy();
  });
});
