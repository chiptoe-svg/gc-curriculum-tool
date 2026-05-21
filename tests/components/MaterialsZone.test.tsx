import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MaterialsZone } from '@/app/preview/[slug]/courses/[code]/MaterialsZone';

const initialMat = {
  id: 'mat-1',
  fileName: 'rubric.pdf',
  blobUrl: 'https://blob.vercel-storage.com/rubric.pdf',
  extractionStatus: 'ok' as const,
};

describe('MaterialsZone', () => {
  it('renders existing materials', () => {
    render(<MaterialsZone courseCode="GC 3460" slug="test-slug" initialMaterials={[initialMat]} />);
    expect(screen.getByText('rubric.pdf')).toBeTruthy();
  });

  it('adds a new material after a successful upload', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'mat-2', fileName: 'worksheet.docx', blobUrl: 'https://blob.vercel-storage.com/worksheet.docx', extractionStatus: 'ok' }),
    } as Response);

    render(<MaterialsZone courseCode="GC 3460" slug="test-slug" initialMaterials={[initialMat]} />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['%PDF'], 'worksheet.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    Object.defineProperty(input, 'files', { value: [file] });

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input);

    await waitFor(() => expect(screen.getByText('worksheet.docx')).toBeTruthy());
  });

  it('shows image-content warning for text-extracted PDFs', () => {
    const pdfTextMaterial = {
      id: 'mat-pdf',
      fileName: 'rubric-with-images.pdf',
      blobUrl: 'https://blob.vercel-storage.com/rubric.pdf',
      extractionStatus: 'ok' as const,
      extractionMethod: 'text',
      pageCount: 3,
    };
    render(<MaterialsZone courseCode="GC 3460" slug="test-slug" initialMaterials={[pdfTextMaterial]} />);
    expect(screen.getByText(/may contain images/i)).toBeTruthy();
  });

  it('does not show image warning for DOCX files', () => {
    const docxMaterial = {
      id: 'mat-docx',
      fileName: 'rubric.docx',
      blobUrl: 'https://blob.vercel-storage.com/rubric.docx',
      extractionStatus: 'ok' as const,
      extractionMethod: 'text',
    };
    render(<MaterialsZone courseCode="GC 3460" slug="test-slug" initialMaterials={[docxMaterial]} />);
    expect(screen.queryByText(/may contain images/i)).toBeNull();
  });

  it('shows image-content warning for low_text text-extracted PDFs', () => {
    const lowTextPdfMaterial = {
      id: 'mat-low',
      fileName: 'scan.pdf',
      blobUrl: 'https://blob.vercel-storage.com/scan.pdf',
      extractionStatus: 'low_text' as const,
      extractionMethod: 'text',
      pageCount: 2,
    };
    render(<MaterialsZone courseCode="GC 3460" slug="test-slug" initialMaterials={[lowTextPdfMaterial]} />);
    expect(screen.getByText(/may contain images/i)).toBeTruthy();
  });

  it('does not show image warning for vision-extracted PDFs', () => {
    const visionPdfMaterial = {
      id: 'mat-vision',
      fileName: 'scan-vision.pdf',
      blobUrl: 'https://blob.vercel-storage.com/scan-vision.pdf',
      extractionStatus: 'ok' as const,
      extractionMethod: 'vision',
      pageCount: 2,
    };
    render(<MaterialsZone courseCode="GC 3460" slug="test-slug" initialMaterials={[visionPdfMaterial]} />);
    expect(screen.queryByText(/may contain images/i)).toBeNull();
  });
});
