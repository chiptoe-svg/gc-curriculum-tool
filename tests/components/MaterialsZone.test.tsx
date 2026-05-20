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
});
