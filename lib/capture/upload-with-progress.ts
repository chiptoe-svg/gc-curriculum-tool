/**
 * XHR-based file upload with real byte-level progress.
 *
 * `fetch()` cannot report upload (request-body) progress — only download
 * progress via response streams. For large materials (image-heavy lecture decks
 * near the 100 MB cap) faculty need to see the transfer advancing, so we drop to
 * XMLHttpRequest, which exposes `upload.onprogress`.
 *
 * Shared by every material-upload surface (OtherMaterialsBox, SyllabusBox, the
 * MaterialsPanel manager) so the progress UX and the response contract stay
 * identical across them.
 */

export interface UploadProgress {
  /** Bytes sent so far. */
  loaded: number;
  /** Total bytes to send (0 if the browser can't compute it). */
  total: number;
  /** 0–100, integer. 100 once the body is fully sent (server may still be working). */
  pct: number;
}

export interface UploadResult {
  ok: boolean;
  status: number;
  /** Parsed JSON body, or {} when the response wasn't JSON. */
  json: unknown;
}

export interface UploadOptions {
  /** POST target, e.g. `/api/courses/GC%203400/materials`. */
  url: string;
  file: File;
  /** Faculty slug (second factor) — sent as a form field, mirroring the fetch path. */
  slug: string;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
  /**
   * Injectable XHR factory for tests. Defaults to `new XMLHttpRequest()`.
   */
  xhrFactory?: () => XMLHttpRequest;
}

/**
 * Uploads a single file via multipart/form-data, reporting transfer progress.
 * Resolves with {ok, status, json} (never rejects on HTTP errors — only on
 * network failure or abort), matching how the fetch-based callers branch on
 * `res.ok`.
 */
export function uploadFileWithProgress(opts: UploadOptions): Promise<UploadResult> {
  const { url, file, slug, onProgress, signal, xhrFactory } = opts;

  return new Promise<UploadResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const xhr = xhrFactory ? xhrFactory() : new XMLHttpRequest();
    const form = new FormData();
    form.set('slug', slug);
    form.set('file', file);

    if (onProgress) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        const total = e.lengthComputable ? e.total : 0;
        const pct = total > 0 ? Math.min(100, Math.round((e.loaded / total) * 100)) : 0;
        onProgress({ loaded: e.loaded, total, pct });
      };
      // Body fully sent — show 100% while the server finishes the response.
      xhr.upload.onload = () => onProgress({ loaded: file.size, total: file.size, pct: 100 });
    }

    xhr.onload = () => {
      let json: unknown = {};
      try {
        json = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        json = {};
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, json });
    };
    xhr.onerror = () => reject(new Error('network error during upload'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));

    if (signal) {
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.open('POST', url);
    xhr.send(form);
  });
}
