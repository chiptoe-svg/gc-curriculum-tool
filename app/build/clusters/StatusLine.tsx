'use client';

/**
 * One cluster status in words (statusLabel), with what explains it: the reason, an out-of-date override, and a failed
 * match's error with Try again. A Matching or Not met reading whose match failed reads "Couldn't check" with the error
 * (couldNotCheck), never Not met. Skills only: no competencies or levels.
 */
import { couldNotCheck, statusLabel, type StatusResult } from '@/lib/builder/cluster/status';

export function StatusLine(props: {
  r: StatusResult; codeOf: (ref: string) => string;
  /** What the target is, for the out-of-date override text. */
  noun: 'objective' | 'skill';
  error: string | null; onRetry: () => void;
}) {
  const { r, error } = props;
  const failed = couldNotCheck(r, error);
  return (
    <span className={`cl-status cl-status--${failed ? 'error' : r.status}`}>
      {failed ? null : statusLabel(r, props.codeOf)}
      {r.reason && !failed && <span className="cl-status__why"> ({r.reason})</span>}
      {r.staleOverride && <span className="cl-status__why"> Override out of date (the {props.noun} changed)</span>}
      {error && (
        <span className={failed ? undefined : 'cl-status__err'}>{failed ? "Couldn't check: " : ' · '}{error}{' '}
          <button type="button" className="cb-linkbtn" onClick={props.onRetry}>Try again</button>
        </span>
      )}
    </span>
  );
}

/** The skills a Met, Partly met or set status rests on: "From <course>: <skill>", one line each. */
export function SupplierLines(props: { r: StatusResult; codeOf: (ref: string) => string }) {
  const { r } = props;
  if (!r.suppliers.length) return null;
  return (
    <div className="cb-req__meta">
      {r.suppliers.map(s => <div key={`${s.course}|${s.ref}`}>From {props.codeOf(s.course)}: {s.statement}</div>)}
    </div>
  );
}
