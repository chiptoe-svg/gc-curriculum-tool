'use client';

/**
 * Shared upload-progress UI for the material-upload surfaces (OtherMaterialsBox,
 * SyllabusBox, MaterialsPanel). Renders a labeled determinate bar driven by the
 * byte-level progress from uploadFileWithProgress. When `pct` reaches 100 the
 * body is fully sent and the server is finishing — we show "finishing…" so the
 * full bar doesn't read as "done" prematurely.
 */

export interface UploadProgressState {
  /** Current file's name. */
  fileName: string;
  /** 1-based index of the current file in the batch. */
  index: number;
  /** Total files in the batch. */
  total: number;
  /** 0–100 byte progress for the current file. */
  pct: number;
}

export function UploadProgressBar({ state }: { state: UploadProgressState }) {
  const { fileName, index, total, pct } = state;
  const done = pct >= 100;
  return (
    <div className="rounded-md border border-input bg-muted/30 px-3 py-2" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate">
          {total > 1 ? `Uploading ${index} of ${total}: ` : 'Uploading: '}
          <span className="font-medium text-foreground">{fileName}</span>
        </span>
        <span className="shrink-0 tabular-nums">{done ? 'finishing…' : `${pct}%`}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={'h-full rounded-full transition-[width] duration-150 ' + (done ? 'bg-foreground/40 animate-pulse' : 'bg-foreground')}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}
