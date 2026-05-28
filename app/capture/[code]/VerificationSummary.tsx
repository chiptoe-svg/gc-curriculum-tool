'use client';

import type { CaptureVerificationSummary } from '@/lib/ai/capture/schema';
import { SourceBadge } from './ProfileReviewPanel';
import { LegacyBanner } from './LegacyBanner';

interface Props {
  summary: CaptureVerificationSummary;
  /** When true, renders the amber legacy-draft banner above the summary. */
  isLegacy?: boolean;
}

function BulletList({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h4>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-sm leading-snug border-l-2 border-muted pl-3">{it}</li>
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
 */
export function VerificationSummary({ summary, isLegacy }: Props) {
  return (
    <section className="rounded-md border bg-amber-50/50 px-4 py-4 shadow-sm space-y-4">
      {isLegacy && <LegacyBanner />}
      <header>
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            Does this capture your course?
          </p>
          <SourceBadge source={summary.source} citations={summary.citations} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Read each section and decide whether the system got it right. Use
          &ldquo;Back to chat&rdquo; if anything looks off, or &ldquo;Confirm and snapshot&rdquo;
          when ready to lock this in as a permanent record.
        </p>
      </header>

      <div>
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Course shape
        </h4>
        <p className="mt-1 text-sm leading-snug">{summary.course_shape}</p>
      </div>

      <BulletList items={summary.strongest_evidence} label="What the course is developing" />
      <BulletList items={summary.dimensional_patterns} label="Where the system saw mixed signals" />
      <BulletList items={summary.catalog_vs_evidence} label="Where catalog and evidence disagree" />

      <div>
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Foundationals
        </h4>
        <p className="mt-1 text-sm leading-snug">{summary.foundationals_glance}</p>
      </div>
    </section>
  );
}
