import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddFileButton, fileMarkers, type AttachedFile } from '@/app/capture/[code]/AddFileButton';

function Harness({ sessionId = 's1', onFiles }: { sessionId?: string | null; onFiles?: (f: AttachedFile[]) => void }) {
  const [files, setFiles] = useState<AttachedFile[]>([]);
  return (
    <AddFileButton courseCode="GC 1010" slug="sl" sessionId={sessionId} disabled={false} files={files}
      onChange={f => { setFiles(f); onFiles?.(f); }} />
  );
}
function pick(name = 'Zine.pdf') {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], name, { type: 'application/pdf' })] } });
}
const json = (b: object, status = 200) => new Response(JSON.stringify(b), { status });

describe('AddFileButton', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('uploads with the session and shows reading then ready', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (init?.method === 'POST') return json({ id: 'm1', fileName: 'Zine.pdf', indexingStatus: 'queued', duplicateOf: null });
      return json({ id: 'm1', indexingStatus: 'ready', extractionStatus: 'ready' });
    });
    render(<Harness />);
    pick();
    expect(screen.getByText('Uploading…')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Reading your file…')).toBeTruthy());
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!;
    const form = post[1]!.body as FormData;
    expect(form.get('sessionId')).toBe('s1');
    expect(form.get('slug')).toBe('sl');
    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy(), { timeout: 8000 });
  }, 12000);

  it('duplicate points at the existing file', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ id: 'old1', duplicateOf: 'old1', indexingStatus: 'ready' }));
    let last: AttachedFile[] = [];
    render(<Harness onFiles={f => { last = f; }} />);
    pick();
    await waitFor(() => expect(screen.getByText('Already in your materials')).toBeTruthy());
    expect(fileMarkers(last)).toEqual(['[Instructor added a file: Zine.pdf (id=old1) — search it before answering.]']);
  });

  it('removing a chip deletes the material and sends nothing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (init?.method === 'POST') return json({ id: 'm1', fileName: 'Zine.pdf', indexingStatus: 'ready', duplicateOf: null });
      if (init?.method === 'DELETE') return json({ deleted: true });
      return json({ id: 'm1', indexingStatus: 'ready', extractionStatus: 'ready' });
    });
    render(<Harness />);
    pick();
    await waitFor(() => screen.getByLabelText('Remove Zine.pdf'));
    fireEvent.click(screen.getByLabelText('Remove Zine.pdf'));
    await waitFor(() => expect(screen.queryByText('Zine.pdf')).toBeNull());
    const del = fetchMock.mock.calls.find(c => c[1]?.method === 'DELETE')!;
    expect(String(del[0])).toContain('/api/courses/GC%201010/materials/m1');
  });

  it('removing a chip while it uploads deletes the material once the upload lands', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (init?.method === 'POST') { await gate; return json({ id: 'm9', fileName: 'Zine.pdf', indexingStatus: 'queued', duplicateOf: null }); }
      return json({ deleted: true });
    });
    render(<Harness />);
    pick();
    fireEvent.click(await screen.findByLabelText('Remove Zine.pdf'));
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'DELETE')).toBe(false);
    release();
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => c[1]?.method === 'DELETE');
      expect(del && String(del[0])).toContain('/materials/m9');
    });
  });

  it('a failed upload has no marker and removing it fires no DELETE', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: 'x' }, 500));
    let last: AttachedFile[] = [];
    render(<Harness onFiles={f => { last = f; }} />);
    pick();
    await waitFor(() => screen.getByText('Could not read this file'));
    expect(fileMarkers(last)).toEqual([]);
    fireEvent.click(screen.getByLabelText('Remove Zine.pdf'));
    await waitFor(() => expect(screen.queryByText('Zine.pdf')).toBeNull());
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'DELETE')).toBe(false);
  });

  it('disabled without a session', () => {
    render(<Harness sessionId={null} />);
    expect((screen.getByRole('button', { name: /add a file/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('fileMarkers', () => {
  it('sends now with the file pending', () => {
    const m = fileMarkers([{ id: 'm1', name: 'Zine.pdf', state: 'reading' }, { id: 'tmp-2', name: 'Up.pdf', state: 'uploading' }]);
    expect(m[0]).toBe('[Instructor added a file: Zine.pdf (id=m1) — search it before answering.] (still being read)');
    expect(m).toHaveLength(1); // still uploading: no id yet, so it waits for the next send
  });
  it('a failed file sends the could-not-be-read marker', () => {
    const m = fileMarkers([{ id: 'm1', name: 'Zine.pdf', state: 'failed' }]);
    expect(m[0]).toContain('it could not be read');
    expect(m[0]).not.toContain('still being read');
  });
});
