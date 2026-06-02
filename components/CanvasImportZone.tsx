'use client';

import { useState } from 'react';

/**
 * The shape an upload (file or Canvas import) hands back to the parent so
 * it can append a row to the materials list optimistically. Mirror of the
 * server `course_materials` row, minus database-only fields.
 */
export interface UploadedMaterial {
  id: string;
  fileName: string;
  blobUrl: string;
  extractionStatus: 'pending' | 'ok' | 'low_text' | 'failed';
  extractionMethod?: string;
}

interface Props {
  courseCode: string;
  slug: string;
  onImported: (material: UploadedMaterial) => void;
  /**
   * Optional controlled open state. When provided, the parent owns the
   * collapse/expand state and the internal toggle becomes a callback.
   * Useful when a sibling component (e.g. another section's header)
   * needs to drive the zone open.
   */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}

interface ImportDetails {
  syllabusFound: boolean;
  assignments: string[];
  modules: string[];
  pages: string[];
  discussions: string[];
  quizzes: string[];
  files: string[];
  filesSkipped: number;
  /**
   * Total items dropped by the skip-unpublished filter, summed across
   * assignments / modules / module items / pages / discussions / quizzes.
   * 0 when the filter was off.
   */
  unpublishedSkipped: number;
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
      {details.pages.length > 0 && (
        <ToggleList label={`✓ Pages (${details.pages.length})`} items={details.pages} />
      )}
      {details.discussions.length > 0 && (
        <ToggleList label={`✓ Discussions (${details.discussions.length})`} items={details.discussions} />
      )}
      {details.quizzes.length > 0 && (
        <ToggleList label={`✓ Quizzes (${details.quizzes.length})`} items={details.quizzes} />
      )}
      {details.files.length > 0 && (
        <ToggleList
          label={`✓ Files extracted (${details.files.length}${details.filesSkipped > 0 ? `; ${details.filesSkipped} skipped` : ''})`}
          items={details.files}
        />
      )}
      {details.unpublishedSkipped > 0 && (
        <li className="text-muted-foreground/70">
          · {details.unpublishedSkipped} unpublished item{details.unpublishedSkipped === 1 ? '' : 's'} skipped
        </li>
      )}
    </ul>
  );
}

export function CanvasImportZone({ courseCode, slug, onImported, open: controlledOpen, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(open) : next;
    if (onOpenChange) onOpenChange(resolved);
    else setInternalOpen(resolved);
  };
  const [canvasUrl, setCanvasUrl] = useState('');
  const [canvasToken, setCanvasToken] = useState('');
  const [skipUnpublished, setSkipUnpublished] = useState(true);
  const [scanLinkedDocs, setScanLinkedDocs] = useState(true);
  const [status, setStatus] = useState<'idle' | 'importing' | 'scanning' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [importDetails, setImportDetails] = useState<ImportDetails | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);

  async function handleImport() {
    setStatus('importing');
    setMessage('');
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(courseCode)}/canvas-import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug,
          canvasUrl: canvasUrl.trim(),
          canvasToken: canvasToken.trim(),
          skipUnpublished,
        }),
      });
      // The route hands back JSON for every defined error path. If the response
      // isn't JSON (typically Next.js's HTML 500 page from an unhandled
      // exception), surface that as a clear "server error" message instead of
      // letting JSON.parse throw a cryptic "expected pattern" error.
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        setStatus('error');
        setMessage(
          `Server returned ${res.status} ${res.statusText || ''} with a non-JSON response. ` +
          `This usually means an unhandled error on the server. ` +
          (text.length < 200 ? `Body: ${text}` : 'Check the server logs for details.'),
        );
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        setStatus('error');
        setMessage((json as { error?: string }).error ?? `Import failed (${res.status})`);
        return;
      }
      const data = json as {
        imported: number;
        inserted?: number;
        updated?: number;
        materials: Array<{ id: string; fileName: string }>;
        details: ImportDetails;
      };
      for (const m of data.materials) {
        onImported({
          id: m.id,
          fileName: m.fileName,
          blobUrl: canvasUrl.trim(),
          extractionStatus: 'ok',
          extractionMethod: 'text',
        });
      }
      // Don't set done here — wait for the optional scan-linked-docs chain
      // below. If the scan is skipped, we set done at the end of the block.
      // Canvas import is upsert by (course, fileName). When re-importing, most
      // items will be `updated` (refreshed in place); first import they'll all
      // be `inserted`. Surface both so faculty can see whether their action
      // pulled in new content vs refreshed existing.
      const ins = data.inserted ?? data.imported;
      const upd = data.updated ?? 0;
      const parts: string[] = [];
      if (ins > 0) parts.push(`${ins} new`);
      if (upd > 0) parts.push(`${upd} refreshed`);
      const summary = parts.length > 0 ? parts.join(' + ') : '0 items';
      setMessage(`Synced from Canvas: ${summary}.`);
      setImportDetails(data.details);
      setCanvasToken('');

      // Chained scan-linked-docs: pulls YouTube captions for any video URL
      // referenced in the imported material text, and downloads any Google
      // Docs / Sheets / Slides / Drive PDFs that resolve. Faculty can
      // opt-out by unchecking the box (e.g. for re-imports where the linked
      // docs haven't changed).
      if (scanLinkedDocs) {
        setStatus('scanning');
        try {
          const scanRes = await fetch(
            `/api/courses/${encodeURIComponent(courseCode)}/scan-linked-docs?slug=${encodeURIComponent(slug)}`,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
          );
          if (scanRes.ok) {
            const scanJson = await scanRes.json() as {
              youtube_fetched?: Array<{ status: string }>;
              files_fetched?: Array<{ status: string }>;
              [k: string]: unknown;
            };
            const yt = (scanJson.youtube_fetched ?? []).filter(x => x.status === 'ok').length;
            const files = (scanJson.files_fetched ?? []).filter(x => x.status === 'ok').length;
            const parts: string[] = [];
            if (yt > 0) parts.push(`${yt} YouTube transcript${yt === 1 ? '' : 's'}`);
            if (files > 0) parts.push(`${files} linked file${files === 1 ? '' : 's'}`);
            setScanSummary(parts.length > 0 ? `+ ${parts.join(' + ')} fetched` : 'no new linked content');
          } else {
            setScanSummary('linked-docs scan failed (canvas import succeeded)');
          }
        } catch {
          setScanSummary('linked-docs scan failed (canvas import succeeded)');
        }
      }
      setStatus('done');
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
          <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={skipUnpublished}
              onChange={e => setSkipUnpublished(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <span>
              <span className="font-medium text-foreground">Skip unpublished items</span>
              <span className="ml-1 text-muted-foreground/80">— exclude draft assignments, quizzes, pages, and module items so they don&apos;t pollute the audit. Uncheck to import everything tagged <span className="font-mono">[unpublished]</span>.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={scanLinkedDocs}
              onChange={e => setScanLinkedDocs(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <span>
              <span className="font-medium text-foreground">Scan linked content after import</span>
              <span className="ml-1 text-muted-foreground/80">— auto-fetch YouTube captions, Google Docs / Slides / Sheets, and Drive PDFs referenced in the imported material. Without this, links sit in the materials but their content is invisible to the auditor. Uncheck for a faster re-import when linked content hasn&apos;t changed.</span>
            </span>
          </label>
          <button
            type="button"
            onClick={handleImport}
            disabled={!canvasUrl || !canvasToken || status === 'importing' || status === 'scanning'}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'importing' ? 'Importing…'
              : status === 'scanning' ? 'Scanning linked docs…'
              : 'Import from Canvas'}
          </button>
          {status === 'done' && (
            <div className="space-y-1">
              <p className="text-sm text-green-700">
                {message}
                {scanSummary && <span className="ml-1 text-muted-foreground">{scanSummary}.</span>}
              </p>
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
