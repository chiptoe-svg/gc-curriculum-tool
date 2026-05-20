import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UploadZone } from '@/app/preview/[slug]/courses/[code]/UploadZone';

describe('UploadZone', () => {
  it('renders the drop area with instructional text', () => {
    render(<UploadZone courseCode="GC 3460" slug="test-slug" onUploaded={vi.fn()} />);
    expect(screen.getByText(/drag.*drop|upload/i)).toBeTruthy();
  });

  it('shows an error when an unsupported file type is dropped', () => {
    render(<UploadZone courseCode="GC 3460" slug="test-slug" onUploaded={vi.fn()} />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    // Simulate selecting an unsupported file type.
    const file = new File(['content'], 'image.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    expect(screen.getByText(/unsupported|pdf.*docx|only pdf/i)).toBeTruthy();
  });

  it('calls onUploaded with the server response after a successful fetch', async () => {
    const onUploaded = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'mat-1', fileName: 'rubric.pdf', extractionStatus: 'ok' }),
    } as Response);

    render(<UploadZone courseCode="GC 3460" slug="test-slug" onUploaded={onUploaded} />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['%PDF content'], 'rubric.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    // Wait for the async upload.
    await vi.waitFor(() => expect(onUploaded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mat-1', extractionStatus: 'ok' }),
    ));
  });
});
