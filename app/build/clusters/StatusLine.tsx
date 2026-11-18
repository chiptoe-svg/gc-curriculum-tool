'use client';

/**
 * One cluster status in words (statusLabel), with what explains it: the reason, an out-of-date override, and a failed
 * match's error with Try again. A pending status whose match failed shows the error in place of "Matching…", never
 * Not met. Skills only: no competencies or levels.
 */
import { statusLabel, type StatusResult } from '@/lib/builder/cluster/status';

export function StatusLine(props: {
  r: StatusResult; codeOf: (ref: string) => string;
  /** What the target is, for the out-of-date override text. */
  noun: 'objective' | 'skill';
  error: string | null; onRetry: () => void;
}) {
  const { r, error } = props;
  const failed = !!error && r.status === 'pending';
  return (
    <span className={`cl-status cl-status--${failed ? 'error' : r.status}`}>
      {failed ? null : statusLabel(r, props.codeOf)}
      {r.reason && !failed && <span className="cl-status__why"> ({r.reason})</span>}
      {r.staleOverride && <span className="cl-status__why"> Override out of date (the {props.noun} changed)</span>}
      {error && (
        <span className={failed ? undefined : 'cl-status__err'}>{failed ? '' : ' · '}{error}{' '}
          <button type="button" className="cb-linkbtn" onClick={props.onRetry}>Try again</button>
        </span>
      )}
    </span>
  );
}
