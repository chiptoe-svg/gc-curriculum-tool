import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CaptureMaterial, CourseCatalogView } from '@/app/capture/[code]/MaterialsPanel';

vi.mock('@/app/capture/[code]/boxes/SyllabusBox', () => ({
  SyllabusBox: () => <div data-testid="syllabus-box">syllabus</div>,
}));
vi.mock('@/app/capture/[code]/boxes/CanvasBox', () => ({
  CanvasBox: () => <div data-testid="canvas-box">canvas</div>,
}));
vi.mock('@/app/capture/[code]/boxes/OtherMaterialsBox', () => ({
  OtherMaterialsBox: () => <div data-testid="other-box">other</div>,
}));
vi.mock('@/app/capture/[code]/MaterialsPanel', () => ({
  MaterialsPanel: () => <div data-testid="materials-manager">manager</div>,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CaptureMaterialsStep } from '@/app/capture/[code]/CaptureMaterialsStep';

const course = { code: 'GC 3800', title: 'Junior Seminar', description: 'A course', prerequisites: '', learningObjectives: ['x','y'], majorProjects: [], skillsRequired: [], auditMode: 'full' } as unknown as CourseCatalogView;
function mat(o: Partial<CaptureMaterial>): CaptureMaterial {
  return { id:o.id??'m', fileName:o.fileName??'f.pdf', mimeType:'application/pdf', sizeBytes:1, pageCount:null, extractionStatus:'ok', extractionMethod:null, extractedText:o.extractedText??'x', ignored:o.ignored??false, digest:null, digestGeneratedAt:null, useDigest:false, indexingStatus:o.indexingStatus??'ready', indexedAt:null, ferpaRisk:'ok' as never, autoSetAside:false, setAsideReason:o.setAsideReason??null, blobUrl:'', ignoredItems:o.ignoredItems, ...o } as CaptureMaterial;
}
const noop = () => {};

describe('CaptureMaterialsStep — three source-boxes', () => {
  it('renders the Syllabus, Canvas, and Other boxes', () => {
    render(<CaptureMaterialsStep course={course} materials={[mat({})]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    expect(screen.getByTestId('syllabus-box')).toBeTruthy();
    expect(screen.getByTestId('canvas-box')).toBeTruthy();
    expect(screen.getByTestId('other-box')).toBeTruthy();
  });

  it('Continue calls onContinue', () => {
    const onContinue = vi.fn();
    render(<CaptureMaterialsStep course={course} materials={[mat({})]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onContinue).toHaveBeenCalled();
  });

  // Aggregate active/ignored/token counters were dropped 2026-06-12 (operator
  // walkthrough) — the boxes summarize themselves. The token figure survives
  // only as a large-corpus warning at the 150k threshold.
  it('shows no aggregate counter line for a small corpus', () => {
    render(<CaptureMaterialsStep course={course} materials={[mat({ id: 'a' }), mat({ id: 'b', ignored: true })]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    expect(screen.queryByText(/active ·/)).toBeNull();
    expect(screen.queryByText(/k tok/)).toBeNull();
  });

  it('warns when the active corpus exceeds the large threshold (150k tokens)', () => {
    const big = mat({ id: 'big', extractedText: 'x'.repeat(700_000) }); // ~175k tokens at 4 chars/tok
    render(<CaptureMaterialsStep course={course} materials={[big]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    expect(screen.getByText(/large; consider ignoring or summarizing/i)).toBeTruthy();
  });

  it('renders the materials-manager disclosure as a prominent button', () => {
    render(<CaptureMaterialsStep course={course} materials={[mat({})]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    expect(screen.getByRole('button', { name: /manage all materials in detail/i })).toBeTruthy();
  });

  it('offers a start-anyway path when there are no materials and no synced syllabus', () => {
    const onContinue = vi.fn();
    render(<CaptureMaterialsStep course={course} materials={[]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: /start without/i }));
    expect(onContinue).toHaveBeenCalled();
  });

  it('reveals the full materials manager from the bottom disclosure', () => {
    render(<CaptureMaterialsStep course={course} materials={[mat({})]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} />);
    expect(screen.queryByTestId('materials-manager')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /manage all materials/i }));
    expect(screen.getByTestId('materials-manager')).toBeTruthy();
  });
});
