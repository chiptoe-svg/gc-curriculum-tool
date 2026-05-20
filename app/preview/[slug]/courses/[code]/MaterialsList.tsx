'use client';

import { Badge } from '@/components/ui/badge';
import type { UploadedMaterial } from './UploadZone';

interface Props {
  courseCode: string;
  slug: string;
  materials: UploadedMaterial[];
  onDelete: (id: string) => void;
  deleting: string | null;
}

function StatusBadge({ status }: { status: UploadedMaterial['extractionStatus'] }) {
  if (status === 'ok') {
    return <Badge variant="secondary" className="text-green-800 bg-green-100 border-green-300">Extracted</Badge>;
  }
  if (status === 'low_text') {
    return <Badge variant="secondary" className="text-amber-800 bg-amber-100 border-amber-300">Low text — consider replacing</Badge>;
  }
  if (status === 'failed') {
    return <Badge variant="secondary" className="text-red-800 bg-red-100 border-red-300">Extraction failed</Badge>;
  }
  return <Badge variant="secondary" className="text-slate-600">Pending</Badge>;
}

export function MaterialsList({ materials, onDelete, deleting }: Props) {
  if (materials.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No files uploaded yet. Drag and drop a PDF or DOCX above.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-lg border">
      {materials.map((m) => (
        <li key={m.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{m.fileName}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <StatusBadge status={m.extractionStatus} />
              {m.extractionMethod && (
                <span className="text-xs text-muted-foreground">via {m.extractionMethod}</span>
              )}
              {m.pageCount !== undefined && (
                <span className="text-xs text-muted-foreground">{m.pageCount}p</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDelete(m.id)}
            disabled={deleting === m.id}
            className="shrink-0 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
            aria-label={`Delete ${m.fileName}`}
          >
            {deleting === m.id ? 'Deleting…' : 'Delete'}
          </button>
        </li>
      ))}
    </ul>
  );
}
