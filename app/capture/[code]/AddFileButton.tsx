'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';
import { MATERIAL_UPLOAD_ACCEPT } from '@/lib/courses/upload-types';
import { fileAddedMarker } from '@/lib/ai/agent/interview-controls';

export interface AttachedFile {
  id: string;
  name: string;
  state: 'uploading' | 'reading' | 'ready' | 'failed' | 'duplicate' | 'skipped' | 'setAside';
  /** The chip points at a material that was already there: removing the chip must not delete it. */
  dup?: boolean;
}

/** What the chat panel can ask of the button: it owns the chips, so it clears the ones a send used. */
export interface AddFileHandle {
  clearSent(ids: string[]): void;
}

const POLL_MS = 3000;
const GIVE_UP_MS = 120_000;

const LABEL: Record<AttachedFile['state'], string> = {
  uploading: 'Uploading…',
  reading: 'Reading your file…',
  ready: 'Ready',
  failed: 'Could not read this file',
  duplicate: 'Already in your materials',
  skipped: 'Set aside — not read',
  setAside: 'Set aside under Materials — not read',
};

const isTemp = (f: AttachedFile) => f.id.startsWith('tmp-');

/** Marker lines for the files that have an id (an upload in flight, or one that failed, has none). */
export function fileMarkers(files: AttachedFile[]): string[] {
  return files
    .filter(f => !isTemp(f))
    .map(f => {
      if (f.state === 'failed' || f.state === 'skipped' || f.state === 'setAside') return fileAddedMarker(f.name, f.id, false);
      const m = fileAddedMarker(f.name, f.id, true);
      return f.state === 'reading' ? `${m} (still being read)` : m;
    });
}

export function AddFileButton(props: {
  courseCode: string;
  slug: string;
  sessionId: string | null;
  disabled: boolean;
  files: AttachedFile[];
  onChange: (files: AttachedFile[]) => void;
  handle?: MutableRefObject<AddFileHandle | null>;
}) {
  const { courseCode, slug, sessionId, disabled, files, onChange, handle } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const started = useRef(new Map<string, number>());
  if (handle) {
    handle.current = {
      clearSent(ids) {
        filesRef.current = filesRef.current.filter(f => !ids.includes(f.id));
        onChange(filesRef.current);
      },
    };
  }
  const base = `/api/courses/${encodeURIComponent(courseCode)}/materials`;

  function update(match: (f: AttachedFile) => boolean, patch: Partial<AttachedFile>) {
    filesRef.current = filesRef.current.map(f => (match(f) ? { ...f, ...patch } : f));
    onChange(filesRef.current);
  }

  async function deleteMaterial(id: string) {
    try {
      await fetch(`${base}/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' });
    } catch { /* nothing more to do */ }
  }

  async function upload(file: File) {
    const tmp = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    filesRef.current = [...filesRef.current, { id: tmp, name: file.name, state: 'uploading' }];
    onChange(filesRef.current);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('slug', slug);
      if (sessionId) form.append('sessionId', sessionId);
      const res = await fetch(base, { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string; duplicateOf?: string | null; indexingStatus?: string; setAside?: boolean;
      };
      if (!res.ok || !data.id) throw new Error('upload failed');
      if (!filesRef.current.some(f => f.id === tmp)) {
        // The instructor removed the chip while the upload was running.
        if (!data.duplicateOf) await deleteMaterial(data.id);
        return;
      }
      if (data.duplicateOf) {
        const existing = data.duplicateOf;
        if (filesRef.current.some(f => f.id === existing)) {
          // Already shown as a chip: drop this one (no second key, poll or marker).
          filesRef.current = filesRef.current.filter(f => f.id !== tmp);
          onChange(filesRef.current);
          return;
        }
        const st = data.indexingStatus;
        const state: AttachedFile['state'] = data.setAside ? 'setAside' : st === 'ready' ? 'duplicate' : st === 'skipped' ? 'skipped' : 'reading';
        if (state === 'reading') started.current.set(existing, Date.now());
        update(f => f.id === tmp, { id: existing, state, dup: true });
      } else {
        started.current.set(data.id, Date.now());
        update(f => f.id === tmp, { id: data.id, state: 'reading' });
      }
    } catch {
      update(f => f.id === tmp, { state: 'failed' });
    }
  }

  const reading = files.filter(f => f.state === 'reading').map(f => f.id).join(',');
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(async () => {
      for (const f of filesRef.current.filter(x => x.state === 'reading')) {
        let next: AttachedFile['state'] | null = null;
        try {
          const r = await fetch(`/api/capture/${encodeURIComponent(courseCode)}/ingest-status?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(f.id)}`);
          if (r.ok) {
            const s = (await r.json()) as { indexingStatus?: string; extractionStatus?: string };
            if (s.indexingStatus === 'ready') next = 'ready';
            else if (s.indexingStatus === 'skipped') next = 'skipped';
            else if (s.indexingStatus === 'failed' || s.extractionStatus === 'failed') next = 'failed';
          }
        } catch { /* keep polling */ }
        if (!next && Date.now() - (started.current.get(f.id) ?? Date.now()) > GIVE_UP_MS) next = 'failed';
        if (next) update(x => x.id === f.id && x.state === 'reading', { state: next });
      }
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading, courseCode, slug]);

  async function remove(f: AttachedFile) {
    filesRef.current = filesRef.current.filter(x => x.id !== f.id);
    onChange(filesRef.current);
    if (!f.dup && !isTemp(f)) await deleteMaterial(f.id);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={MATERIAL_UPLOAD_ACCEPT}
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      <button type="button" className="cap-btn" disabled={disabled || !sessionId} onClick={() => inputRef.current?.click()}>
        Add a file
      </button>
      {files.map(f => (
        <span key={f.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#D9D6DF] bg-white px-2.5 py-1 text-xs">
          <span className="truncate">{f.name}</span>
          <span className={f.state === 'failed' ? 'text-red-700' : 'text-muted-foreground'}>{LABEL[f.state]}</span>
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => void remove(f)} className="px-0.5">×</button>
        </span>
      ))}
    </div>
  );
}
