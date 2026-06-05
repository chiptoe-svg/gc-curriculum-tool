'use client';

/**
 * Client island: edge seed / confirm / edit / delete + add.
 * Props are plain-serialisable so they can be passed from a server component.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PrereqEdgeRow } from '@/lib/db/prerequisite-edge-queries';

interface Props {
  code: string;
  slug: string;
  initialEdges: PrereqEdgeRow[];
  initialUnknownPrereqs: string[];
  /** Map of subCompetencyId → display name */
  subCompNames: Record<string, string>;
  /** All available sub-competencies for the "add" control */
  allSubComps: Array<{ id: string; name: string; targetName: string }>;
}

// ─── Inline number input ───────────────────────────────────────────────────

function KudInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="font-mono-plex text-[10px] uppercase tracking-[0.14em] text-muted-foreground w-3">{label}</span>
      <input
        type="number"
        min={0}
        max={5}
        step={1}
        value={value ?? ''}
        placeholder="—"
        className="w-10 rounded border border-border bg-background px-1 py-0.5 text-center font-mono-plex text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        onChange={(e) => {
          const raw = e.target.value.trim();
          onChange(raw === '' ? null : Math.max(0, Math.min(5, Number(raw))));
        }}
      />
    </label>
  );
}

// ─── Single edge row ──────────────────────────────────────────────────────

function EdgeRow({
  edge,
  subCompName,
  slug,
  code,
  onMutated,
}: {
  edge: PrereqEdgeRow;
  subCompName: string;
  slug: string;
  code: string;
  onMutated: () => void;
}) {
  const [k, setK] = useState<number | null>(edge.expectedK);
  const [u, setU] = useState<number | null>(edge.expectedU);
  const [d, setD] = useState<number | null>(edge.expectedD);
  const [confirmed, setConfirmed] = useState(edge.confirmed);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const base = `/api/admin/courses/${encodeURIComponent(code)}/prereq-edges?slug=${encodeURIComponent(slug)}`;

  async function patch(updates: Record<string, unknown>) {
    setError(null);
    try {
      const res = await fetch(base, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: edge.id, ...updates }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setError(j.error ?? `Error ${res.status}`);
      } else {
        onMutated();
      }
    } catch {
      setError('Network error');
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete edge: ${edge.prereqCourseCode} → ${subCompName}?`)) return;
    setError(null);
    try {
      const res = await fetch(`${base}&id=${encodeURIComponent(edge.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setError(j.error ?? `Error ${res.status}`);
      } else {
        onMutated();
      }
    } catch {
      setError('Network error');
    }
  }

  function handleKudBlur() {
    startTransition(() => {
      void patch({ expected_k: k, expected_u: u, expected_d: d });
    });
  }

  function handleConfirmToggle() {
    const next = !confirmed;
    setConfirmed(next);
    startTransition(() => {
      void patch({ confirmed: next });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-card px-3 py-2">
      {/* Sub-competency name */}
      <span className="flex-1 min-w-[12rem] text-sm font-medium leading-snug">
        {subCompName}
        <span className="ml-1.5 font-mono-plex text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60">
          {edge.source === 'llm_seed' ? 'ai-seeded' : 'faculty'}
        </span>
      </span>

      {/* KUD inputs */}
      <div className="flex items-center gap-2" onBlur={handleKudBlur}>
        <KudInput label="K" value={k} onChange={setK} />
        <KudInput label="U" value={u} onChange={setU} />
        <KudInput label="D" value={d} onChange={setD} />
      </div>

      {/* Confirm toggle */}
      <button
        onClick={handleConfirmToggle}
        disabled={isPending}
        title={confirmed ? 'Confirmed — click to un-confirm' : 'Click to confirm'}
        className={`shrink-0 rounded-full px-2.5 py-0.5 font-body-sans text-[10px] uppercase tracking-[0.14em] font-medium transition-colors
          ${confirmed
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 hover:bg-emerald-200'
            : 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400 hover:bg-stone-200'
          }`}
      >
        {confirmed ? 'Confirmed' : 'Unconfirmed'}
      </button>

      {/* Delete */}
      <button
        onClick={() => { void handleDelete(); }}
        className="shrink-0 text-xs text-muted-foreground/40 hover:text-destructive transition-colors"
        title="Delete this edge"
      >
        ✕
      </button>

      {error && (
        <p className="w-full text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

// ─── Group of edges for one prereq course ────────────────────────────────

function PrereqGroup({
  prereqCode,
  edges,
  subCompNames,
  slug,
  code,
  onMutated,
}: {
  prereqCode: string;
  edges: PrereqEdgeRow[];
  subCompNames: Record<string, string>;
  slug: string;
  code: string;
  onMutated: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {prereqCode}
      </p>
      {edges.map((e) => (
        <EdgeRow
          key={e.id}
          edge={e}
          subCompName={subCompNames[e.subCompetencyId] ?? e.subCompetencyId}
          slug={slug}
          code={code}
          onMutated={onMutated}
        />
      ))}
    </div>
  );
}

// ─── Add edge control ─────────────────────────────────────────────────────

function AddEdgeControl({
  code,
  slug,
  allSubComps,
  onMutated,
}: {
  code: string;
  slug: string;
  allSubComps: Props['allSubComps'];
  onMutated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [prereqCode, setPrereqCode] = useState('');
  const [subCompId, setSubCompId] = useState('');
  const [ek, setEk] = useState<number | null>(null);
  const [eu, setEu] = useState<number | null>(null);
  const [ed, setEd] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const base = `/api/admin/courses/${encodeURIComponent(code)}/prereq-edges?slug=${encodeURIComponent(slug)}`;

  function handleAdd() {
    if (!prereqCode.trim() || !subCompId) {
      setError('Prereq course code and sub-competency are required.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`${base}&mode=add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prereqCourseCode: prereqCode.trim().toUpperCase(),
            subCompetencyId: subCompId,
            expected_k: ek,
            expected_u: eu,
            expected_d: ed,
          }),
        });
        const j = await res.json().catch(() => ({})) as { error?: string };
        if (!res.ok) {
          if (res.status === 409) {
            setError(`Cycle detected: ${j.error ?? 'adding this edge would create a prerequisite cycle.'}`);
          } else {
            setError(j.error ?? `Error ${res.status}`);
          }
          return;
        }
        setPrereqCode('');
        setSubCompId('');
        setEk(null);
        setEu(null);
        setEd(null);
        setOpen(false);
        onMutated();
      } catch {
        setError('Network error');
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        + Add edge
      </button>
    );
  }

  return (
    <div className="rounded border border-border bg-card p-4 space-y-3">
      <p className="font-body-sans text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Add edge
      </p>
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Prereq course code</label>
          <input
            type="text"
            value={prereqCode}
            onChange={(e) => setPrereqCode(e.target.value)}
            placeholder="e.g. GC 2010"
            className="w-32 rounded border border-border bg-background px-2 py-1 font-mono-plex text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[16rem]">
          <label className="text-xs text-muted-foreground">Sub-competency</label>
          <select
            value={subCompId}
            onChange={(e) => setSubCompId(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Select…</option>
            {allSubComps.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.targetName} — {sc.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">Expected attainment:</span>
        <KudInput label="K" value={ek} onChange={setEk} />
        <KudInput label="U" value={eu} onChange={setEu} />
        <KudInput label="D" value={ed} onChange={setEd} />
      </div>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={handleAdd}
          disabled={isPending}
          className="rounded bg-foreground px-3 py-1.5 text-xs text-background hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? 'Adding…' : 'Add'}
        </button>
        <button
          onClick={() => { setOpen(false); setError(null); }}
          className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export function PrereqEdgesClient({
  code,
  slug,
  initialEdges,
  initialUnknownPrereqs,
  subCompNames,
  allSubComps,
}: Props) {
  const router = useRouter();
  const [edges, setEdges] = useState<PrereqEdgeRow[]>(initialEdges);
  const [unknownPrereqs, setUnknownPrereqs] = useState<string[]>(initialUnknownPrereqs);
  const [seedResult, setSeedResult] = useState<{ inserted: number; skippedConfirmed: number } | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [isSeeding, startSeedTransition] = useTransition();

  const base = `/api/admin/courses/${encodeURIComponent(code)}/prereq-edges?slug=${encodeURIComponent(slug)}`;

  async function refreshEdges() {
    try {
      const res = await fetch(`${base}`, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json() as { edges: PrereqEdgeRow[]; unknownPrereqs: string[] };
        setEdges(j.edges);
        setUnknownPrereqs(j.unknownPrereqs);
      }
    } catch {
      // swallow — router.refresh will catch server state
    }
    router.refresh();
  }

  function handleSeed() {
    setSeedError(null);
    setSeedResult(null);
    startSeedTransition(async () => {
      try {
        const res = await fetch(`${base}&mode=seed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'seed' }),
        });
        const j = await res.json().catch(() => ({})) as {
          inserted?: number;
          skippedConfirmed?: number;
          unknownPrereqs?: string[];
          error?: string;
        };
        if (!res.ok) {
          setSeedError(j.error ?? `Error ${res.status}`);
          return;
        }
        setSeedResult({
          inserted: j.inserted ?? 0,
          skippedConfirmed: j.skippedConfirmed ?? 0,
        });
        if (j.unknownPrereqs) {
          setUnknownPrereqs((prev) =>
            [...new Set([...prev, ...(j.unknownPrereqs ?? [])])].sort(),
          );
        }
        await refreshEdges();
      } catch {
        setSeedError('Network error');
      }
    });
  }

  // Group edges by prereqCourseCode
  const grouped = new Map<string, PrereqEdgeRow[]>();
  for (const e of edges) {
    if (!grouped.has(e.prereqCourseCode)) grouped.set(e.prereqCourseCode, []);
    grouped.get(e.prereqCourseCode)!.push(e);
  }

  return (
    <div className="space-y-6">
      {/* Seed button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSeed}
          disabled={isSeeding}
          className="rounded bg-foreground px-4 py-2 text-sm text-background hover:opacity-90 disabled:opacity-50"
        >
          {isSeeding ? 'Seeding from syllabus…' : 'Seed from syllabus prerequisites'}
        </button>
        {seedResult && (
          <p className="text-sm text-muted-foreground">
            Seeded {seedResult.inserted} edge{seedResult.inserted !== 1 ? 's' : ''}
            {seedResult.skippedConfirmed > 0 && `, skipped ${seedResult.skippedConfirmed} confirmed`}.
          </p>
        )}
        {seedError && (
          <p className="text-sm text-destructive">{seedError}</p>
        )}
      </div>

      {/* Unknown prereqs */}
      {unknownPrereqs.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 space-y-1">
          <p className="font-body-sans text-xs font-medium uppercase tracking-[0.14em] text-amber-800 dark:text-amber-300">
            Unknown prerequisite courses — not yet in the catalog
          </p>
          <ul className="space-y-0.5">
            {unknownPrereqs.map((uc) => (
              <li key={uc} className="text-sm text-amber-900 dark:text-amber-200">
                <span className="font-mono-plex">{uc}</span>
                {' — '}
                <a
                  href={`/courses?slug=${encodeURIComponent(slug)}`}
                  className="text-amber-700 underline hover:no-underline dark:text-amber-400"
                >
                  add it to the roster
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Edge list grouped by prereq course */}
      {grouped.size === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No prerequisite edges yet. Seed from the syllabus or add manually.
        </p>
      ) : (
        <div className="space-y-5">
          {Array.from(grouped.entries()).map(([prereqCode, groupEdges]) => (
            <PrereqGroup
              key={prereqCode}
              prereqCode={prereqCode}
              edges={groupEdges}
              subCompNames={subCompNames}
              slug={slug}
              code={code}
              onMutated={() => { void refreshEdges(); }}
            />
          ))}
        </div>
      )}

      {/* Add edge control */}
      <AddEdgeControl
        code={code}
        slug={slug}
        allSubComps={allSubComps}
        onMutated={() => { void refreshEdges(); }}
      />
    </div>
  );
}
