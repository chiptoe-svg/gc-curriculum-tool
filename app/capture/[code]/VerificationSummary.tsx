'use client';

import type { CaptureVerificationSummary, CaptureProfileCitationType } from '@/lib/ai/capture/schema';
import { plainDepth } from '@/lib/capture/plain-depth';
import { SourceBadge } from './ProfileReviewPanel';
import { LegacyBanner } from './LegacyBanner';

interface Props {
  summary: CaptureVerificationSummary;
  /** When true, renders the amber legacy-draft banner above the summary. */
  isLegacy?: boolean;
  /** When supplied, SourceBadge becomes interactive. */
  onCitationClick?: (c: CaptureProfileCitationType) => void;
  /** Exactly what the approve button says in this state. */
  approveLabel?: string;
  /** True once a snapshot exists: approving records an update. */
  isUpdate?: boolean;
}

const HEADING = 'text-sm font-semibold text-foreground';

function BulletList({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className={HEADING}>{label}</h4>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-sm leading-snug border-l-2 border-amber-200 pl-3">{plainDepth(it)}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The "does this capture your course?" verification banner. Rendered above
 * the competency cards on the review panel. The instructor reads each
 * section and decides whether the system has captured the course faithfully
 * — strict description, no recommendations.
 *
 * Every string passes through plainDepth() so score codes the AI wrote
 * ("— D3 via Budget", "K2/U2/D1") read as words, including on profiles
 * generated before the prompt asked for plain language.
 */
export function VerificationSummary({ summary, isLegacy, onCitationClick, approveLabel = 'Approve the profile', isUpdate = false }: Props) {
  return (
    <section className="rounded-md border bg-amber-50/50 px-4 py-4 shadow-sm space-y-4">
      {isLegacy && <LegacyBanner />}
      <header>
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
            Does this capture your course?
          </h3>
          {/* An "inferred" chip only repeated what the copy below says; keep the
              badge for summaries that cite the instructor or materials. */}
          {summary.source !== 'inferred' && (
            <SourceBadge source={summary.source} citations={summary.citations} onCitationClick={onCitationClick} />
          )}
        </div>
        <div
          role="note"
          aria-label="How to review"
          className="mt-3 rounded-md border-l-4 border-amber-500 bg-background px-4 py-3 text-base leading-relaxed text-foreground shadow-sm"
        >
          <p className="font-semibold">How to review</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5">
            <li>Read the overview below: what the interview found about your course.</li>
            <li>
              Under it are the areas the AI was least sure about. For each one, choose{' '}
              <strong>&#10003; Looks right</strong> or <strong>Needs adjusting</strong> to change a score.
            </li>
            <li>
              When every card is done, use &ldquo;{approveLabel}&rdquo; to record{' '}
              {isUpdate ? 'this version as a new snapshot — earlier snapshots are kept' : 'it'}.
            </li>
          </ol>
          <p className="mt-2 text-sm text-muted-foreground">
            Only if the overview gets the course badly wrong — not just a score or two — go{' '}
            &ldquo;← Back to the interview&rdquo; and tell the interviewer what it missed.
          </p>
        </div>
      </header>

      <div>
        <h4 className={HEADING}>Course shape</h4>
        <p className="mt-1.5 text-sm leading-snug">{plainDepth(summary.course_shape)}</p>
      </div>

      <BulletList items={summary.strongest_evidence} label="What the course is developing" />
      <BulletList items={summary.dimensional_patterns} label="Where the system saw mixed signals" />
      <BulletList items={summary.catalog_vs_evidence} label="Where catalog and evidence disagree" />

      <div>
        <h4 className={HEADING}>Foundational habits</h4>
        <p className="mt-1.5 text-sm leading-snug">{plainDepth(summary.foundationals_glance)}</p>
      </div>
    </section>
  );
}
