'use client';

import { useRef, useState } from 'react';
import type { CaptureCourseOverview, CaptureProfileCitationType, CaptureProfileSourceType } from '@/lib/ai/capture/schema';
import { SourceBadge } from './ProfileReviewPanel';

// ---------------------------------------------------------------------------
// Marginalia label — small-caps, DM Sans, restrained
// ---------------------------------------------------------------------------
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-body-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1 select-none">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// NarrativeSection — multi-paragraph Fraunces prose + drop cap
// ---------------------------------------------------------------------------
interface NarrativeSectionProps {
  narrative: string;
  editable: boolean;
  onChange: (next: string) => void;
}
function NarrativeSection({ narrative, editable, onChange }: NarrativeSectionProps) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleClick() {
    if (editable && !editing) setEditing(true);
  }

  function handleBlur() {
    setEditing(false);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
    // Auto-grow
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        autoFocus
        value={narrative}
        onChange={handleChange}
        onBlur={handleBlur}
        className={[
          'w-full resize-none overflow-hidden rounded-sm bg-muted/40 px-1 py-0.5',
          'font-display text-[1.0625rem] leading-[1.72] text-foreground',
          'focus:outline-none focus:ring-1 focus:ring-ring',
          'max-w-[65ch]',
        ].join(' ')}
        style={{ minHeight: '6rem' }}
        onFocus={el => {
          // auto-size on focus
          const t = el.target as HTMLTextAreaElement;
          t.style.height = 'auto';
          t.style.height = t.scrollHeight + 'px';
        }}
      />
    );
  }

  // Render paragraphs with drop-cap on the first
  const paragraphs = narrative.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) {
    return (
      <div
        onClick={handleClick}
        className="font-display text-[1.0625rem] leading-[1.72] text-muted-foreground italic cursor-text rounded-sm hover:bg-muted/40 px-1 py-0.5 max-w-[65ch]"
      >
        Click to add a narrative…
      </div>
    );
  }

  return (
    <div onClick={handleClick} className="space-y-[0.9em] max-w-[65ch]">
      {paragraphs.map((para, i) => (
        <p
          key={i}
          className={[
            'font-display text-[1.0625rem] leading-[1.72] text-foreground text-pretty',
            'rounded-sm px-1 hover:bg-muted/40 cursor-text transition-colors duration-150',
            // Drop cap only on the first paragraph
            i === 0
              ? '[&::first-letter]:text-[3.5rem] [&::first-letter]:font-bold [&::first-letter]:float-left [&::first-letter]:leading-[0.82] [&::first-letter]:mr-[0.06em] [&::first-letter]:mt-[0.1em] [&::first-letter]:font-display'
              : '',
          ].join(' ')}
        >
          {para}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AtAGlanceSection — em-dash bullets
// ---------------------------------------------------------------------------
interface AtAGlanceSectionProps {
  bullets: string[];
  editable: boolean;
  onChange: (next: string[]) => void;
}
function AtAGlanceSection({ bullets, editable, onChange }: AtAGlanceSectionProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  function handleBulletChange(i: number, val: string) {
    const next = bullets.slice();
    next[i] = val;
    onChange(next);
  }

  function handleBulletBlur(i: number) {
    // Remove empty bullets on blur
    if (bullets[i] === '') {
      const next = bullets.filter((_, idx) => idx !== i);
      onChange(next);
    }
    setEditingIndex(null);
  }

  function handleBulletKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Insert a new bullet after this one
      const next = [...bullets.slice(0, i + 1), '', ...bullets.slice(i + 1)];
      onChange(next);
      setEditingIndex(i + 1);
    } else if (e.key === 'Backspace' && bullets[i] === '') {
      e.preventDefault();
      const next = bullets.filter((_, idx) => idx !== i);
      onChange(next);
      setEditingIndex(Math.max(0, i - 1));
    }
  }

  function handleAddBullet() {
    const next = [...bullets, ''];
    onChange(next);
    setEditingIndex(next.length - 1);
  }

  return (
    <div className="space-y-1.5">
      <SectionLabel>At a glance</SectionLabel>
      <ul className="space-y-1.5 list-none">
        {bullets.map((bullet, i) => (
          <li key={i} className="flex items-baseline gap-0">
            <span
              className="font-body-sans text-[0.95rem] text-muted-foreground select-none shrink-0 mr-1"
              aria-hidden
            >
              —
            </span>
            {editable && editingIndex === i ? (
              <input
                autoFocus
                type="text"
                value={bullet}
                onChange={e => handleBulletChange(i, e.target.value)}
                onBlur={() => handleBulletBlur(i)}
                onKeyDown={e => handleBulletKeyDown(i, e)}
                className={[
                  'flex-1 font-body-sans text-[0.95rem] bg-muted/40 rounded-sm px-1',
                  'focus:outline-none focus:ring-1 focus:ring-ring border-0',
                ].join(' ')}
              />
            ) : (
              <span
                className={[
                  'flex-1 font-body-sans text-[0.95rem] leading-snug text-foreground',
                  editable ? 'cursor-text rounded-sm px-1 hover:bg-muted/40 transition-colors duration-150' : '',
                ].join(' ')}
                onClick={() => editable && setEditingIndex(i)}
              >
                {bullet || <em className="text-muted-foreground">empty bullet — click to edit</em>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {editable && bullets.length < 7 && (
        <button
          type="button"
          onClick={handleAddBullet}
          className="mt-1 ml-4 font-body-sans text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
        >
          + Add bullet
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InlineEditableText — single-line or short multi-line italic Fraunces
// ---------------------------------------------------------------------------
interface InlineEditableTextProps {
  value: string;
  editable: boolean;
  onChange: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}
function InlineEditableText({
  value,
  editable,
  onChange,
  placeholder = 'Click to edit…',
  multiline = false,
  className = '',
}: InlineEditableTextProps) {
  const [editing, setEditing] = useState(false);

  const displayClass = [
    'font-display italic text-[0.975rem] leading-[1.6] text-foreground',
    editable ? 'cursor-text rounded-sm px-1 hover:bg-muted/40 transition-colors duration-150' : '',
    className,
  ].join(' ');

  if (editing && editable) {
    if (multiline) {
      return (
        <textarea
          autoFocus
          value={value}
          rows={2}
          onChange={e => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          className={[
            'w-full resize-none bg-muted/40 rounded-sm px-1 py-0.5',
            'font-display italic text-[0.975rem] leading-[1.6]',
            'focus:outline-none focus:ring-1 focus:ring-ring',
            className,
          ].join(' ')}
        />
      );
    }
    return (
      <input
        autoFocus
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        className={[
          'w-full bg-muted/40 rounded-sm px-1',
          'font-display italic text-[0.975rem] leading-[1.6]',
          'focus:outline-none focus:ring-1 focus:ring-ring',
          className,
        ].join(' ')}
      />
    );
  }

  return (
    <p
      className={displayClass}
      onClick={() => editable && setEditing(true)}
    >
      {value || <span className="text-muted-foreground">{placeholder}</span>}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Props {
  courseCode: string;
  courseTitle: string;
  overview: CaptureCourseOverview | null;
  onOverviewChange: (next: CaptureCourseOverview) => void;
  /** When false, render read-only. */
  editable: boolean;
  onCitationClick?: (c: CaptureProfileCitationType) => void;
}

// ---------------------------------------------------------------------------
// Null-state placeholder
// ---------------------------------------------------------------------------
function NullOverviewPlaceholder({
  onWrite,
}: {
  onWrite: () => void;
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 px-6 py-8 text-center space-y-3 animate-in fade-in duration-300">
      <p className="font-body-sans text-sm text-muted-foreground">
        No overview drafted yet. Re-audit this course to generate one — or write one from scratch.
      </p>
      <button
        type="button"
        onClick={onWrite}
        className="font-body-sans inline-flex items-center rounded-md border border-input bg-background px-4 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
      >
        Write one
      </button>
    </div>
  );
}

const EMPTY_OVERVIEW: CaptureCourseOverview = {
  narrative: '',
  at_a_glance: ['', '', ''],
  who_for: '',
  arc: '',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function CourseOverview({
  courseCode,
  courseTitle,
  overview,
  onOverviewChange,
  editable,
  onCitationClick,
}: Props) {
  if (!overview) {
    if (!editable) {
      return (
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-6 py-5 animate-in fade-in duration-300">
          <p className="font-body-sans text-sm text-muted-foreground italic">
            No overview available. This profile predates the overview feature — re-audit to generate one.
          </p>
        </div>
      );
    }
    return (
      <NullOverviewPlaceholder
        onWrite={() => onOverviewChange({ ...EMPTY_OVERVIEW })}
      />
    );
  }

  function updateField<K extends keyof CaptureCourseOverview>(key: K, value: CaptureCourseOverview[K]) {
    onOverviewChange({ ...overview!, [key]: value });
  }

  // Stagger animation delays per section (80ms per step)
  const delay = (i: number) => ({ animationDelay: `${i * 80}ms` } as React.CSSProperties);

  const sourceProp = overview.source as CaptureProfileSourceType | undefined;

  return (
    <article className="space-y-8 pb-2">
      {/* ── 1. Title block ── */}
      <div
        className="animate-in fade-in slide-in-from-bottom-1 duration-400 fill-mode-both"
        style={delay(0)}
      >
        <p className="font-mono-plex text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
          {courseCode}
        </p>
        <h1 className="font-display text-[2rem] sm:text-[2.75rem] font-semibold leading-[1.12] tracking-tight text-foreground">
          {courseTitle}
        </h1>
        <div className="mt-4 h-px bg-border opacity-60" />
      </div>

      {/* ── 2. Narrative ── */}
      <div
        className="animate-in fade-in slide-in-from-bottom-1 duration-400 fill-mode-both"
        style={delay(1)}
      >
        <NarrativeSection
          narrative={overview.narrative}
          editable={editable}
          onChange={val => updateField('narrative', val)}
        />
      </div>

      {/* ── 3. At a glance ── */}
      <div
        className="animate-in fade-in slide-in-from-bottom-1 duration-400 fill-mode-both"
        style={delay(2)}
      >
        <AtAGlanceSection
          bullets={overview.at_a_glance}
          editable={editable}
          onChange={val => updateField('at_a_glance', val)}
        />
      </div>

      {/* ── 4. Two-column sidebar (who_for + arc) ── */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-1 duration-400 fill-mode-both"
        style={delay(3)}
      >
        <div>
          <SectionLabel>Who it&apos;s for</SectionLabel>
          <InlineEditableText
            value={overview.who_for}
            editable={editable}
            onChange={val => updateField('who_for', val)}
            placeholder="Designed for…"
          />
        </div>
        <div>
          <SectionLabel>The arc</SectionLabel>
          <InlineEditableText
            value={overview.arc}
            editable={editable}
            onChange={val => updateField('arc', val)}
            placeholder="Students start by…"
            multiline
          />
        </div>
      </div>

      {/* ── 5. Source badge ── */}
      {sourceProp && (
        <div className="flex items-center justify-end animate-in fade-in duration-500 fill-mode-both" style={delay(4)}>
          <SourceBadge
            source={sourceProp}
            citations={overview.citations}
            onCitationClick={onCitationClick}
          />
        </div>
      )}
    </article>
  );
}
