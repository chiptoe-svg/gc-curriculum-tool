// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { uploadFileWithProgress } from '../upload-with-progress';

interface FakeXhrOpts {
  status: number;
  responseText: string;
  emitProgress?: boolean;
}

/** A controllable XMLHttpRequest stub whose send() drives the lifecycle. */
function makeFakeXhr(opts: FakeXhrOpts) {
  const xhr = {
    upload: {} as { onprogress?: (e: ProgressEvent) => void; onload?: () => void },
    open: vi.fn(),
    abort: vi.fn(),
    status: 0,
    responseText: '',
    onload: null as null | (() => void),
    onerror: null as null | (() => void),
    onabort: null as null | (() => void),
    send: vi.fn(),
  };
  xhr.send.mockImplementation(() => {
    queueMicrotask(() => {
      if (opts.emitProgress && xhr.upload.onprogress) {
        xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
      }
      if (xhr.upload.onload) xhr.upload.onload();
      xhr.status = opts.status;
      xhr.responseText = opts.responseText;
      if (xhr.onload) xhr.onload();
    });
  });
  return xhr;
}

function pdf(name = 'h.pdf'): File {
  return new File([new Uint8Array(100)], name, { type: 'application/pdf' });
}

describe('uploadFileWithProgress', () => {
  it('reports byte progress and resolves ok on 2xx', async () => {
    const xhr = makeFakeXhr({ status: 200, responseText: '{"id":"m1","indexingStatus":"pending"}', emitProgress: true });
    const progress: number[] = [];
    const res = await uploadFileWithProgress({
      url: '/api/courses/GC%203400/materials',
      file: pdf(),
      slug: 's',
      onProgress: (p) => progress.push(p.pct),
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    });
    expect(xhr.open).toHaveBeenCalledWith('POST', '/api/courses/GC%203400/materials');
    expect(progress).toContain(50); // mid-transfer
    expect(progress[progress.length - 1]).toBe(100); // upload.onload → 100%
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect((res.json as { id?: string }).id).toBe('m1');
  });

  it('resolves ok:false with the parsed error on a 4xx', async () => {
    const xhr = makeFakeXhr({ status: 400, responseText: '{"error":"file too large"}' });
    const res = await uploadFileWithProgress({
      url: '/x',
      file: pdf(),
      slug: 's',
      xhrFactory: () => xhr as unknown as XMLHttpRequest,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect((res.json as { error?: string }).error).toBe('file too large');
  });

  it('rejects immediately if the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadFileWithProgress({
        url: '/x',
        file: pdf(),
        slug: 's',
        signal: controller.signal,
        xhrFactory: () => makeFakeXhr({ status: 200, responseText: '{}' }) as unknown as XMLHttpRequest,
      }),
    ).rejects.toThrow(/abort/i);
  });
});
