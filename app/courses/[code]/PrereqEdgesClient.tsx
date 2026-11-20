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
    <label className="cs-kud-wrap">
      <span className="cs-label">{label}</span>
      <input
        type="number"
        min={0}
        max={5}
        step={1}
        value={value ?? ''}
        placeholder="—"
        className={`cs-kud ${value === null || value < 0 || value > 5 ? 'cs-dnone' : `cs-d${Math.floor(value)}`}`}
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
    <div className="cs-edge">
      {/* Sub-competency name */}
      <span className="cs-edge-name">
        {subCompName}
        <span className="cs-edge-src">
          {edge.source === 'llm_seed' ? 'ai-seeded' : 'faculty'}
        </span>
      </span>

      {/* KUD inputs */}
      <div className="cs-row" onBlur={handleKudBlur}>
        <KudInput label="K" value={k} onChange={setK} />
        <KudInput label="U" value={u} onChange={setU} />
        <KudInput label="D" value={d} onChange={setD} />
      </div>

      {/* Confirm toggle */}
      <button
        onClick={handleConfirmToggle}
        disabled={isPending}
        title={confirmed ? 'Confirmed — click to un-confirm' : 'Click to confirm'}
        className={`cs-cue ${confirmed ? 'cs-cue-done' : 'cs-cue-draft'}`}
      >
        {confirmed ? 'Confirmed' : 'Unconfirmed'}
      </button>

      {/* Delete */}
      <button
        onClick={() => { void handleDelete(); }}
        className="cs-x"
        title="Delete this edge"
        aria-label="Delete this edge"
      >
        ✕
      </button>

      {error && (
        <p className="cs-err" style={{ width: '100%' }}>{error}</p>
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
    <div className="cs-group-stack">
      <p className="cs-label">
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
        className="cs-link"
        style={{ alignSelf: 'flex-start', minHeight: 36 }}
      >
        + Add edge
      </button>
    );
  }

  return (
    <div className="cs-card cs-card-pad cs-stack" style={{ gap: 14 }}>
      <p className="cs-label">
        Add edge
      </p>
      <div className="cs-row" style={{ alignItems: 'flex-end' }}>
        <div className="cs-field">
          <label>Prereq course code</label>
          <input
            type="text"
            value={prereqCode}
            onChange={(e) => setPrereqCode(e.target.value)}
            placeholder="e.g. GC 2010"
            className="cs-input cs-mono" style={{ width: '8rem' }}
          />
        </div>
        <div className="cs-field" style={{ flex: '1 1 16rem' }}>
          <label>Sub-competency</label>
          <select
            value={subCompId}
            onChange={(e) => setSubCompId(e.target.value)}
            className="cs-input"
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
      <div className="cs-row">
        <span className="cs-meta">Expected attainment:</span>
        <KudInput label="K" value={ek} onChange={setEk} />
        <KudInput label="U" value={eu} onChange={setEu} />
        <KudInput label="D" value={ed} onChange={setEd} />
      </div>
      {error && (
        <p className="cs-err">{error}</p>
      )}
      <div className="cs-row">
        <button
          onClick={handleAdd}
          disabled={isPending}
          className="cs-btn cs-btn-primary cs-btn-sm"
        >
          {isPending ? 'Adding…' : 'Add'}
        </button>
        <button
          onClick={() => { setOpen(false); setError(null); }}
          className="cs-btn cs-btn-sm"
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
    <div className="cs-stack" style={{ gap: 24 }}>
      {/* Seed button */}
      <div className="cs-row">
        <button
          onClick={handleSeed}
          disabled={isSeeding}
          className="cs-btn cs-btn-primary"
        >
          {isSeeding ? 'Seeding from syllabus…' : 'Seed from syllabus prerequisites'}
        </button>
        {seedResult && (
          <p className="cs-meta">
            Seeded {seedResult.inserted} edge{seedResult.inserted !== 1 ? 's' : ''}
            {seedResult.skippedConfirmed > 0 && `, skipped ${seedResult.skippedConfirmed} confirmed`}.
          </p>
        )}
        {seedError && (
          <p className="cs-err">{seedError}</p>
        )}
      </div>

      {/* Unknown prereqs */}
      {unknownPrereqs.length > 0 && (
        <div className="cs-alert cs-alert-input">
          <p className="cs-label" style={{ color: '#8A5A00' }}>
            Unknown prerequisite courses — not yet in the catalog
          </p>
          <ul>
            {unknownPrereqs.map((uc) => (
              <li key={uc}>
                <span className="cs-mono">{uc}</span>
                {' — '}
                <a
                  href={`/courses?slug=${encodeURIComponent(slug)}`}
                  style={{ textUnderlineOffset: 3 }}
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
        <p className="cs-meta">
          No prerequisite edges yet. Seed from the syllabus or add manually.
        </p>
      ) : (
        <div className="cs-stack">
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
