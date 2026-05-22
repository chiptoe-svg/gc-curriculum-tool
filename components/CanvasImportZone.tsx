'use client';

import { useState } from 'react';
import type { UploadedMaterial } from '@/app/preview/[slug]/courses/[code]/UploadZone';

interface Props {
  courseCode: string;
  slug: string;
  onImported: (material: UploadedMaterial) => void;
}

interface ImportDetails {
  syllabusFound: boolean;
  assignments: string[];
  modules: string[];
}

function ToggleList({ label, items }: { label: string; items: string[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1 hover:text-foreground"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>{label}</span>
      </button>
      {expanded && (
        <ul className="pl-4 mt-0.5 space-y-0.5 text-muted-foreground/70">
          {items.map(name => <li key={name}>{name}</li>)}
        </ul>
      )}
    </li>
  );
}

function ImportSummary({ details }: { details: ImportDetails }) {
  return (
    <ul className="text-xs text-muted-foreground space-y-1 border-l-2 border-green-200 pl-3 ml-1">
      {details.syllabusFound && <li>✓ Syllabus</li>}
      {details.assignments.length > 0 && (
        <ToggleList label={`✓ Assignments (${details.assignments.length})`} items={details.assignments} />
      )}
      {details.modules.length > 0 && (
        <ToggleList label={`✓ Module list (${details.modules.length} modules)`} items={details.modules} />
      )}
    </ul>
  );
}

export function CanvasImportZone({ courseCode, slug, onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState('');
  const [canvasToken, setCanvasToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [importDetails, setImportDetails] = useState<{ syllabusFound: boolean; assignments: string[]; modules: string[] } | null>(null);

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
      const data = json as { imported: number; materials: Array<{ id: string; fileName: string }>; details: { syllabusFound: boolean; assignments: string[]; modules: string[] } };
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
      setImportDetails(data.details);
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
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              Open your course in Canvas and copy the URL from your browser&apos;s address bar. It ends with <span className="font-mono">/courses/</span> followed by a number.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="canvas-token">API token</label>
            <input
              id="canvas-token"
              type="password"
              value={canvasToken}
              onChange={e => setCanvasToken(e.target.value)}
              placeholder="Your Canvas access token"
              className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              In Canvas: click your name (top-right) → <strong className="font-medium text-muted-foreground">Settings</strong> → scroll to <strong className="font-medium text-muted-foreground">Approved Integrations</strong> → <strong className="font-medium text-muted-foreground">+ New Access Token</strong>. Give it any name, leave expiry blank, then copy the token — Canvas only shows it once.
            </p>
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
            <div className="space-y-1">
              <p className="text-sm text-green-700">{message}</p>
              {importDetails && <ImportSummary details={importDetails} />}
            </div>
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
