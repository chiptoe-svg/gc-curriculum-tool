'use client';

import { useState } from 'react';
import type { UploadedMaterial } from '@/app/preview/[slug]/courses/[code]/UploadZone';

interface Props {
  courseCode: string;
  slug: string;
  onImported: (material: UploadedMaterial) => void;
}

export function CanvasImportZone({ courseCode, slug, onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState('');
  const [canvasToken, setCanvasToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleImport() {
    setStatus('importing');
    setMessage('');
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(courseCode)}/canvas-import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, canvasUrl: canvasUrl.trim(), canvasToken: canvasToken.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus('error');
        setMessage((json as { error?: string }).error ?? `Import failed (${res.status})`);
        return;
      }
      const data = json as { imported: number; materials: Array<{ id: string; fileName: string }> };
      for (const m of data.materials) {
        onImported({
          id: m.id,
          fileName: m.fileName,
          blobUrl: canvasUrl.trim(),
          extractionStatus: 'ok',
          extractionMethod: 'text',
        });
      }
      setStatus('done');
      setMessage(`Imported ${data.imported} item${data.imported !== 1 ? 's' : ''} from Canvas.`);
      setCanvasToken('');
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Import failed');
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/10 px-4 py-3 space-y-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <span>Import from Canvas</span>
        <span className="text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="canvas-url">Canvas course URL</label>
            <input
              id="canvas-url"
              type="url"
              value={canvasUrl}
              onChange={e => setCanvasUrl(e.target.value)}
              placeholder="https://clemson.instructure.com/courses/12345"
              className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="canvas-token">
              API token{' '}
              <span className="text-muted-foreground/70 font-normal">
                — Canvas → Profile → Settings → Approved Integrations → New Access Token
              </span>
            </label>
            <input
              id="canvas-token"
              type="password"
              value={canvasToken}
              onChange={e => setCanvasToken(e.target.value)}
              placeholder="Your Canvas access token"
              className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <button
            type="button"
            onClick={handleImport}
            disabled={!canvasUrl || !canvasToken || status === 'importing'}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'importing' ? 'Importing…' : 'Import from Canvas'}
          </button>
          {status === 'done' && (
            <p className="text-sm text-green-700">{message}</p>
          )}
          {status === 'error' && (
            <p className="text-sm text-destructive">{message}</p>
          )}
          <p className="text-xs text-muted-foreground leading-relaxed">
            The token is used only during this request and is never stored. It fetches your course syllabus, assignments, and module list, then stores the extracted text for AI analysis.
          </p>
        </div>
      )}
    </div>
  );
}
