'use client';

import { useRef, useState } from 'react';

export interface UploadedMaterial {
  id: string;
  fileName: string;
  blobUrl: string;
  extractionStatus: 'pending' | 'ok' | 'low_text' | 'failed';
  extractionMethod?: string;
  pageCount?: number;
}

interface Props {
  courseCode: string;
  slug: string;
  onUploaded: (material: UploadedMaterial) => void;
}

// Mirrors lib/courses/material-extractor's SUPPORTED_MIME_TYPES. PDF and
// DOCX work on the Vercel deploy via unpdf/mammoth; PPTX/XLSX/CSV/HTML/
// image require the local Docling pipeline (Phase 2 hybrid deploy).
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/html',
  'image/png',
  'image/jpeg',
]);

interface UploadState {
  fileName: string;
  progress: 'uploading' | 'done' | 'error';
  error?: string;
}

export function UploadZone({ courseCode, slug, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<UploadState | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFiles(files: FileList | null) {
    setTypeError(null);
    if (!files || files.length === 0) return;
    const file = files[0]!;

    if (!ALLOWED_TYPES.has(file.type)) {
      setTypeError(
        `Unsupported file type (${file.type || 'unknown'}). ` +
        `Accepted: PDF, DOCX, PPTX, XLSX, CSV, HTML, PNG, JPG. ` +
        `Legacy .doc/.ppt/.xls aren't supported — re-save as the modern format.`,
      );
      return;
    }

    setUploading({ fileName: file.name, progress: 'uploading' });
    const form = new FormData();
    form.set('slug', slug);
    form.set('file', file);

    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(courseCode)}/materials`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setUploading({ fileName: file.name, progress: 'error', error: (json as { error?: string }).error ?? `Upload failed (${res.status})` });
        return;
      }
      const material = (await res.json()) as UploadedMaterial;
      setUploading({ fileName: file.name, progress: 'done' });
      onUploaded(material);
    } catch (e) {
      setUploading({ fileName: file.name, progress: 'error', error: e instanceof Error ? e.message : 'Upload failed' });
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
        dragging ? 'border-primary bg-accent' : 'border-muted-foreground/30 bg-muted/20'
      }`}
    >
      <p className="text-sm text-muted-foreground">
        Drag &amp; drop or{' '}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={() => inputRef.current?.click()}
        >
          browse
        </button>{' '}
        to upload assignment materials (PDF, DOCX, PPTX, XLSX, CSV, HTML, PNG, JPG · max 15 MB per file)
      </p>

      <input
        ref={inputRef}
        data-testid="file-input"
        type="file"
        accept={[
          'application/pdf', '.pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx',
          'text/csv', '.csv',
          'text/html', '.html', '.htm',
          'image/png', '.png',
          'image/jpeg', '.jpg', '.jpeg',
        ].join(',')}
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {typeError && (
        <p className="mt-3 text-sm text-destructive">{typeError}</p>
      )}

      {uploading && (
        <div className="mt-4 w-full max-w-sm text-sm">
          <p className="truncate text-muted-foreground">
            {uploading.fileName} —{' '}
            {uploading.progress === 'uploading' && (
              <span className="text-primary animate-pulse">Uploading &amp; extracting…</span>
            )}
            {uploading.progress === 'done' && (
              <span className="text-green-700">Done</span>
            )}
            {uploading.progress === 'error' && (
              <span className="text-destructive">{uploading.error}</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
