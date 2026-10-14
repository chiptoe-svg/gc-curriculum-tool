'use client';

import { useEffect, useMemo, useState } from 'react';

// P2 bundle review (spec 2026-10-13-bundle-membership-p2-design.md §5, task-12).
// Admin /api second factor goes in the body/query, NOT an Authorization
// header — a Bearer header would override the browser's automatic HTTP Basic
// Auth and break the middleware gate (same convention as AccessPanel and
// SandboxGrantsPanel). Blindness is enforced server-side (Task 11); this
// panel renders only what the API returns and never tries to work around it.

const REVIEWER_KEY = 'gc-bundles-reviewer';
const POSITIONS = ['core', 'related', 'fringe'] as const;
type Position = (typeof POSITIONS)[number];
type PickValue = Position | 'none';

export interface BundleListItem {
  id: string;
  name: string;
  stratum: string | null;
  sampled: boolean;
  submitted: boolean;
  counts: { proposed: number; confirmed: number; rejected: number } | null;
  noCleanMatch: boolean | null;
  /** Has an ok mapping outcome — the blind pick can only be submitted once it does. */
  mapped: boolean;
}

export interface ElementDef { elementId: string; elementName: string; domain: string; description: string }
export interface GoldenCandidate { key: string; label: string; rank: number; score: number; members: Array<{ taskId: string; onetSocCode: string }> }
export interface CardFields { stratum: string; includes: string; excludes: string; distinctions: string; positiveExamples: string[]; negativeExamples: string[] }
export interface BundleSummary { id: string; name: string; knowDescriptor: string; understandDescriptor: string; doDescriptor: string; origin: string }
export interface PickView { source: string | null; externalId: string | null; onetSocCode: string | null; position: string | null; noCleanMatch: boolean }
export interface SampleInfo { candidates: GoldenCandidate[]; submitted: boolean; reviewer: string | null; picks: PickView[] }
export interface MemberView { id: string; source: string; externalId: string; externalLabel: string; onetSocCode: string | null; position: string; aiPosition: string | null; status: string; proposedBy: string; rationale: string | null; reviewNote: string | null; bulkConfirmed: boolean }
export interface BundleDetail {
  bundle: BundleSummary;
  card: CardFields | null;
  elements: ElementDef[];
  sample: SampleInfo | null;
  members: MemberView[] | null;
  latestOutcome: { noCleanMatch: boolean; note: string | null } | null;
  attribution?: string;
}

interface AgreementRow { bundleId: string; aiCount: number; blindCount: number; both: number; precision: number | null; recall: number | null; exact: number; withinOne: number; blindTasksOutsideShortlist: number }
interface AgreementResponse {
  rows: AgreementRow[];
  total: AgreementRow;
  kappas: Array<{ bundleId: string; kappa: number | null }>;
  noMatch: Array<{ bundleId: string; note: string | null }>;
  notYetMapped: string[];
  attribution: string;
}

async function errorText(res: Response): Promise<string> {
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return json.error ?? `failed (${res.status})`;
}

export function BundlesPanel({ slug }: { slug: string }) {
  const [reviewer, setReviewer] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REVIEWER_KEY);
      if (saved) setReviewer(saved);
    } catch { /* storage unavailable */ }
  }, []);

  function updateReviewer(v: string) {
    setReviewer(v);
    try { localStorage.setItem(REVIEWER_KEY, v); } catch { /* storage unavailable */ }
  }
  const reviewerReady = reviewer.trim().length > 0;

  const [tab, setTab] = useState<'cards' | 'blind' | 'queue'>('blind');
  const [bundles, setBundles] = useState<BundleListItem[]>([]);
  const [progress, setProgress] = useState<{ reviewed: number; total: number }>({ reviewed: 0, total: 0 });
  const [attribution, setAttribution] = useState('');
  const [listError, setListError] = useState<string | null>(null);

  async function loadList() {
    const res = await fetch(`/api/admin/bundles?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) { setListError(await errorText(res)); return; }
    const json = (await res.json()) as { bundles: BundleListItem[]; progress: { reviewed: number; total: number }; attribution: string };
    setBundles(json.bundles);
    setProgress(json.progress);
    setAttribution(json.attribution);
    setListError(null);
  }

  useEffect(() => { void loadList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- slug is fixed for the panel's lifetime

  const [details, setDetails] = useState<Record<string, BundleDetail>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});

  async function fetchDetail(id: string): Promise<void> {
    const res = await fetch(`/api/admin/bundles/${id}?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) {
      const msg = await errorText(res);
      setDetailErrors((p) => ({ ...p, [id]: msg }));
      return;
    }
    const json = (await res.json()) as BundleDetail;
    setDetails((p) => ({ ...p, [id]: json }));
    setDetailErrors((p) => { const n = { ...p }; delete n[id]; return n; });
  }

  async function refreshBundle(id: string): Promise<void> {
    await fetchDetail(id);
    await loadList();
  }

  return (
    <section className="space-y-6 rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="bundles-reviewer" className="text-xs text-slate-500">Reviewer name</label>
          <input
            id="bundles-reviewer"
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={reviewer}
            onChange={(e) => updateReviewer(e.target.value)}
            placeholder="Your name"
          />
        </div>
        {!reviewerReady && <p className="text-xs text-amber-700">Enter your name to review.</p>}
      </div>

      {listError && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{listError}</p>}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {(['cards', 'blind', 'queue'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 text-sm ${tab === t ? 'bg-slate-800 text-white' : 'border border-slate-300 text-slate-700'}`}
          >
            {t === 'cards' ? 'Cards' : t === 'blind' ? 'Blind sample' : 'Review queue'}
          </button>
        ))}
      </div>

      {tab === 'cards' && (
        <CardsTab bundles={bundles} details={details} detailErrors={detailErrors} fetchDetail={fetchDetail} />
      )}
      {tab === 'blind' && (
        <BlindTab
          slug={slug} reviewer={reviewer} reviewerReady={reviewerReady} bundles={bundles}
          details={details} detailErrors={detailErrors} fetchDetail={fetchDetail} onChanged={refreshBundle}
        />
      )}
      {tab === 'queue' && (
        <QueueTab
          slug={slug} reviewer={reviewer} reviewerReady={reviewerReady} bundles={bundles} progress={progress}
          details={details} detailErrors={detailErrors} fetchDetail={fetchDetail} onChanged={refreshBundle}
        />
      )}

      {attribution && <footer className="pt-4 text-xs text-slate-400">{attribution}</footer>}
    </section>
  );
}

// ─── Cards (read-only) ──────────────────────────────────────────────────────

// Fix I-1 (final-review.md): the mapping prompt (buildPlacementUserMessage in
// lib/ai/catalog/map-bundle-onet.ts) gives the AI the bundle's name, its K/U/D
// descriptors, and the card's includes/excludes/distinctions plus BOTH the
// positive and negative examples. This readout must show the reviewer the
// same set field-for-field, or a blind reviewer places items on less
// information than the AI did, biasing the agreement measure. None of this
// is an AI placement, so showing it does not affect blindness — the bundle
// and card are already returned unconditionally by readBundleDetail.
function CardReadout({ bundle, card }: { bundle: BundleSummary; card: CardFields | null }) {
  return (
    <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
      <div><dt className="text-xs uppercase text-slate-500">Name</dt><dd>{bundle.name}</dd></div>
      <div><dt className="text-xs uppercase text-slate-500">Know</dt><dd>{bundle.knowDescriptor}</dd></div>
      <div><dt className="text-xs uppercase text-slate-500">Understand</dt><dd>{bundle.understandDescriptor}</dd></div>
      <div><dt className="text-xs uppercase text-slate-500">Do</dt><dd>{bundle.doDescriptor}</dd></div>
      {!card && <p className="text-sm text-slate-500 sm:col-span-2">No confirmed cards yet.</p>}
      {card && (
        <>
          <div><dt className="text-xs uppercase text-slate-500">Stratum</dt><dd>{card.stratum}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Includes</dt><dd>{card.includes}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Excludes</dt><dd>{card.excludes}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Distinctions</dt><dd>{card.distinctions}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Belongs here (examples)</dt><dd>{card.positiveExamples.join('; ')}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Does not belong here (examples)</dt><dd>{card.negativeExamples.join('; ')}</dd></div>
        </>
      )}
    </dl>
  );
}

function CardsTab({
  bundles, details, detailErrors, fetchDetail,
}: {
  bundles: BundleListItem[];
  details: Record<string, BundleDetail>;
  detailErrors: Record<string, string>;
  fetchDetail: (id: string) => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  async function toggle(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!details[id]) await fetchDetail(id);
  }

  return (
    <div className="space-y-2">
      {bundles.length === 0 && <p className="text-sm text-slate-500">No bundles yet.</p>}
      {bundles.map((b) => (
        <div key={b.id} className="rounded border border-slate-200">
          <button type="button" className="w-full px-3 py-2 text-left text-sm font-medium" onClick={() => toggle(b.id)}>
            {b.name}
          </button>
          {openId === b.id && (
            <div className="border-t border-slate-200 px-3 py-2">
              {detailErrors[b.id] && <p className="text-sm text-red-800">{detailErrors[b.id]}</p>}
              {!detailErrors[b.id] && !details[b.id] && <p className="text-sm text-slate-500">Loading…</p>}
              {details[b.id] && <CardReadout bundle={(details[b.id] as BundleDetail).bundle} card={(details[b.id] as BundleDetail).card} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Blind sample ───────────────────────────────────────────────────────────

function PositionRadios({
  name, value, onChange, disabled,
}: { name: string; value: PickValue; onChange: (v: PickValue) => void; disabled: boolean }) {
  const options: PickValue[] = ['core', 'related', 'fringe', 'none'];
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {options.map((opt) => (
        <label key={opt} className="flex items-center gap-1">
          <input type="radio" name={name} checked={value === opt} disabled={disabled} onChange={() => onChange(opt)} />
          {opt === 'none' ? 'Not a member' : opt}
        </label>
      ))}
    </div>
  );
}

function BlindPickForm({
  slug, reviewer, reviewerReady, bundleId, detail, mapped, onSubmitted,
}: {
  slug: string; reviewer: string; reviewerReady: boolean; bundleId: string; detail: BundleDetail; mapped: boolean; onSubmitted: () => Promise<void>;
}) {
  const [picks, setPicks] = useState<Record<string, PickValue>>({});
  const [noCleanMatch, setNoCleanMatch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setPick(key: string, v: PickValue) { setPicks((p) => ({ ...p, [key]: v })); }

  const byDomain = useMemo(() => {
    const m = new Map<string, ElementDef[]>();
    for (const el of detail.elements) {
      const arr = m.get(el.domain) ?? [];
      arr.push(el);
      m.set(el.domain, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [detail.elements]);

  async function submit() {
    if (!window.confirm("Submit? You can't change it afterward without an admin reset.")) return;
    setError(null);
    setResult(null);
    const body: { slug: string; reviewer: string; noCleanMatch: boolean; picks: Array<Record<string, unknown>> } = {
      slug, reviewer, noCleanMatch, picks: [],
    };
    if (!noCleanMatch) {
      for (const el of detail.elements) {
        const v = picks[`element:${el.elementId}`];
        if (v && v !== 'none') body.picks.push({ kind: 'element', elementId: el.elementId, position: v });
      }
      for (const c of detail.sample?.candidates ?? []) {
        const v = picks[`task:${c.key}`];
        if (v && v !== 'none') body.picks.push({ kind: 'task', groupKey: c.key, position: v });
      }
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/bundles/${bundleId}/blind`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { setError(await errorText(res)); return; }
      const json = (await res.json()) as { reconcile: { confirmed: number; added: number; disagreements: number } };
      setResult(`Submitted. ${json.reconcile.confirmed} confirmed, ${json.reconcile.added} added, ${json.reconcile.disagreements} sent to the review queue.`);
      await onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <CardReadout bundle={detail.bundle} card={detail.card} />

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-slate-700">Elements by domain</h4>
        {byDomain.map(([domain, els]) => (
          <details key={domain} className="rounded border border-slate-200 p-2">
            <summary className="cursor-pointer text-sm font-medium">{domain}</summary>
            <div className="mt-2 space-y-2">
              {els.map((el) => (
                <div key={el.elementId} className="space-y-1 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-medium">{el.elementName}</span>
                    <PositionRadios
                      name={`element:${el.elementId}`}
                      value={picks[`element:${el.elementId}`] ?? 'none'}
                      onChange={(v) => setPick(`element:${el.elementId}`, v)}
                      disabled={noCleanMatch || !reviewerReady}
                    />
                  </div>
                  <details>
                    <summary className="cursor-pointer text-xs text-slate-500">Definition</summary>
                    <p className="text-xs text-slate-600">{el.description}</p>
                  </details>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-slate-700">Task candidates (top 50)</h4>
        {(detail.sample?.candidates ?? []).map((c) => (
          <div key={c.key} className="flex flex-wrap items-center gap-3 border-b border-slate-100 pb-2">
            <span className="text-sm">{c.label}</span>
            <PositionRadios
              name={`task:${c.key}`}
              value={picks[`task:${c.key}`] ?? 'none'}
              onChange={(v) => setPick(`task:${c.key}`, v)}
              disabled={noCleanMatch || !reviewerReady}
            />
          </div>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={noCleanMatch} onChange={(e) => setNoCleanMatch(e.target.checked)} disabled={!reviewerReady} />
        No clean match
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!reviewerReady || submitting || !mapped}
          onClick={() => void submit()}
          className="rounded bg-slate-800 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Submit blind pick
        </button>
        {!mapped && <p className="text-sm text-amber-800">This bundle hasn&apos;t been mapped yet — run the mapping before its blind pick.</p>}
        {error && <p className="text-sm text-red-800">Couldn&apos;t submit: {error}</p>}
      </div>
      {result && <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{result}</p>}
    </div>
  );
}

function SubmittedBlindPick({
  slug, reviewer, reviewerReady, bundleId, detail, onChanged,
}: {
  slug: string; reviewer: string; reviewerReady: boolean; bundleId: string; detail: BundleDetail; onChanged: (id: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const picks = detail.sample?.picks ?? [];

  async function reset() {
    setError(null);
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/bundles/${bundleId}/reset-blind`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, reviewer, note }),
      });
      if (!res.ok) { setError(await errorText(res)); return; }
      setNote('');
      await onChanged(bundleId);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-3">
      <CardReadout bundle={detail.bundle} card={detail.card} />
      <ul className="space-y-1 text-sm">
        {picks.length === 0 && <li className="text-slate-500">No picks recorded.</li>}
        {picks.map((p, i) => (
          <li key={i}>
            {p.noCleanMatch ? 'No clean match' : `${p.source ?? ''} ${p.externalId ?? ''}${p.onetSocCode ? ` (${p.onetSocCode})` : ''} — ${p.position ?? ''}`}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`reset-note-${bundleId}`} className="text-xs text-slate-500">Reset note</label>
          <input
            id={`reset-note-${bundleId}`}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={!reviewerReady || resetting || note.trim().length === 0}
          onClick={() => void reset()}
          className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
        >
          Reset this blind pick
        </button>
      </div>
      {error && <p className="text-sm text-red-800">Couldn&apos;t reset: {error}</p>}
    </div>
  );
}

function BlindTab({
  slug, reviewer, reviewerReady, bundles, details, detailErrors, fetchDetail, onChanged,
}: {
  slug: string; reviewer: string; reviewerReady: boolean; bundles: BundleListItem[];
  details: Record<string, BundleDetail>; detailErrors: Record<string, string>;
  fetchDetail: (id: string) => Promise<void>; onChanged: (id: string) => Promise<void>;
}) {
  const sampled = bundles.filter((b) => b.sampled);
  const [openId, setOpenId] = useState<string | null>(null);

  async function open(id: string) {
    setOpenId(id);
    await fetchDetail(id);
  }

  return (
    <div className="space-y-2">
      {sampled.length === 0 && <p className="text-sm text-slate-500">No bundles in the blind sample.</p>}
      {sampled.map((b) => (
        <div key={b.id} className="rounded border border-slate-200">
          <div className="flex items-center justify-between px-3 py-2">
            <button type="button" className="text-left text-sm font-medium" onClick={() => void open(b.id)}>{b.name}</button>
            <span className="text-xs text-slate-500">{b.submitted ? 'Submitted' : b.mapped ? 'Not started' : 'Waiting for mapping'}</span>
          </div>
          {openId === b.id && (
            <div className="border-t border-slate-200 px-3 py-3">
              {detailErrors[b.id] && <p className="text-sm text-red-800">{detailErrors[b.id]}</p>}
              {!details[b.id] && !detailErrors[b.id] && <p className="text-sm text-slate-500">Loading…</p>}
              {details[b.id] && (
                b.submitted
                  ? <SubmittedBlindPick slug={slug} reviewer={reviewer} reviewerReady={reviewerReady} bundleId={b.id} detail={details[b.id] as BundleDetail} onChanged={onChanged} />
                  : <BlindPickForm slug={slug} reviewer={reviewer} reviewerReady={reviewerReady} bundleId={b.id} detail={details[b.id] as BundleDetail} mapped={b.mapped} onSubmitted={() => onChanged(b.id)} />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Review queue ───────────────────────────────────────────────────────────

interface GroupedMemberRow { key: string; label: string; ids: string[]; socCodes: string[]; position: string; aiPosition: string | null; status: string; proposedBy: string; rationale: string | null; reviewNote: string | null }

/**
 * Groups same-text task rows under one line listing every SOC code — but
 * only while every member of the group agrees on status, position and
 * review note (the properties the row's own display + action-enablement
 * depend on). A group that has diverged (e.g. "Add an item" inserted one
 * row under a label that already has a sibling under a different SOC, now
 * at a different status or position) is rendered as separate per-member
 * rows instead, so no member's state is hidden and Confirm/Reject/Change
 * position never act on an id whose own state doesn't match what's shown
 * (fix round 1, Important #2). Every row this function returns is thereby
 * homogeneous in status, so `row.status !== 'proposed'` always correctly
 * gates its actions, and `row.ids` always correctly scopes them.
 */
function groupMembers(members: MemberView[]): GroupedMemberRow[] {
  const taskGroups = new Map<string, MemberView[]>();
  const rows: GroupedMemberRow[] = [];
  for (const m of members) {
    if (m.source === 'onet_task') {
      const g = taskGroups.get(m.externalLabel);
      if (g) g.push(m); else taskGroups.set(m.externalLabel, [m]);
    } else {
      rows.push({
        key: m.id, label: m.externalLabel, ids: [m.id], socCodes: [], position: m.position, aiPosition: m.aiPosition,
        status: m.status, proposedBy: m.proposedBy, rationale: m.rationale, reviewNote: m.reviewNote,
      });
    }
  }
  for (const [label, ms] of taskGroups) {
    // ms is never empty (every entry starts from at least one push), so
    // ms[0] is always present — noUncheckedIndexedAccess still types the
    // destructure as possibly undefined, hence the assertion.
    const first = ms[0]!;
    const agrees = ms.slice(1).every((m) => m.status === first.status && m.position === first.position && m.reviewNote === first.reviewNote);
    if (agrees) {
      const socCodes = ms.flatMap((m) => (m.onetSocCode ? [m.onetSocCode] : []));
      rows.push({
        key: `task:${label}`, label: `${label} (${socCodes.join(', ')})`, ids: ms.map((m) => m.id), socCodes,
        position: first.position, aiPosition: first.aiPosition, status: first.status, proposedBy: first.proposedBy,
        rationale: first.rationale, reviewNote: first.reviewNote,
      });
    } else {
      for (const m of ms) {
        rows.push({
          key: m.id, label: `${label}${m.onetSocCode ? ` (${m.onetSocCode})` : ''}`,
          ids: [m.id], socCodes: m.onetSocCode ? [m.onetSocCode] : [], position: m.position, aiPosition: m.aiPosition,
          status: m.status, proposedBy: m.proposedBy, rationale: m.rationale, reviewNote: m.reviewNote,
        });
      }
    }
  }
  return rows;
}

function AddItemBox({
  slug, reviewer, reviewerReady, bundleId, onAdded,
}: { slug: string; reviewer: string; reviewerReady: boolean; bundleId: string; onAdded: () => Promise<void> }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ elements: ElementDef[]; tasks: Array<{ taskId: string; onetSocCode: string; task: string }> }>({ elements: [], tasks: [] });
  const [error, setError] = useState<string | null>(null);
  const [positionByKey, setPositionByKey] = useState<Record<string, Position>>({});

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults({ elements: [], tasks: [] }); return; }
    const t = setTimeout(() => {
      void (async () => {
        const res = await fetch(`/api/admin/bundles/search?q=${encodeURIComponent(term)}&slug=${encodeURIComponent(slug)}`);
        if (res.ok) {
          const json = (await res.json()) as { elements: ElementDef[]; tasks: Array<{ taskId: string; onetSocCode: string; task: string }> };
          setResults({ elements: json.elements, tasks: json.tasks });
        }
      })();
    }, 300);
    return () => clearTimeout(t);
  }, [q, slug]);

  async function add(item: Record<string, unknown>, key: string) {
    const position = positionByKey[key] ?? 'core';
    setError(null);
    const res = await fetch(`/api/admin/bundles/${bundleId}/members`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, reviewer, action: 'add', item, position }),
    });
    if (!res.ok) { setError(`Couldn't add: ${await errorText(res)}`); return; }
    await onAdded();
  }

  return (
    <div className="space-y-2 rounded border border-slate-200 p-3">
      <input
        className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        placeholder="Search elements and tasks…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {results.elements.map((el) => (
        <div key={el.elementId} className="flex flex-wrap items-center gap-2 text-sm">
          <span>{el.elementName}</span>
          <select
            value={positionByKey[`e:${el.elementId}`] ?? 'core'}
            onChange={(e) => setPositionByKey((p) => ({ ...p, [`e:${el.elementId}`]: e.target.value as Position }))}
            className="rounded border border-slate-300 px-1 py-0.5 text-xs"
          >
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button
            type="button"
            disabled={!reviewerReady}
            className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-800 disabled:opacity-40"
            onClick={() => void add({ kind: 'element', elementId: el.elementId }, `e:${el.elementId}`)}
          >
            Add
          </button>
        </div>
      ))}
      {results.tasks.map((t) => (
        <div key={`${t.taskId}:${t.onetSocCode}`} className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t.task}</span>
          <select
            value={positionByKey[`t:${t.taskId}:${t.onetSocCode}`] ?? 'core'}
            onChange={(e) => setPositionByKey((p) => ({ ...p, [`t:${t.taskId}:${t.onetSocCode}`]: e.target.value as Position }))}
            className="rounded border border-slate-300 px-1 py-0.5 text-xs"
          >
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button
            type="button"
            disabled={!reviewerReady}
            className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-800 disabled:opacity-40"
            onClick={() => void add({ kind: 'task', taskId: t.taskId, onetSocCode: t.onetSocCode }, `t:${t.taskId}:${t.onetSocCode}`)}
          >
            Add
          </button>
        </div>
      ))}
      {error && <p className="text-xs text-red-800">{error}</p>}
    </div>
  );
}

function QueueBundleDetail({
  slug, reviewer, reviewerReady, bundleId, detail, onChanged,
}: {
  slug: string; reviewer: string; reviewerReady: boolean; bundleId: string; detail: BundleDetail; onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const members = useMemo(() => detail.members ?? [], [detail.members]);
  const grouped = useMemo(() => groupMembers(members), [members]);
  const byPosition = useMemo(() => {
    const m = new Map<string, GroupedMemberRow[]>();
    for (const pos of POSITIONS) m.set(pos, grouped.filter((g) => g.position === pos));
    return m;
  }, [grouped]);
  const proposedCount = members.filter((m) => m.status === 'proposed').length;

  async function act(ids: string[], action: 'confirm' | 'reject') {
    setError(null);
    const res = await fetch(`/api/admin/bundles/${bundleId}/members`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, reviewer, action, memberIds: ids }),
    });
    if (!res.ok) { setError(`Couldn't ${action}: ${await errorText(res)}`); return; }
    await onChanged();
  }

  async function changePosition(ids: string[], position: string) {
    setError(null);
    const res = await fetch(`/api/admin/bundles/${bundleId}/members`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, reviewer, action: 'set_position', memberIds: ids, position }),
    });
    if (!res.ok) { setError(`Couldn't change position: ${await errorText(res)}`); return; }
    await onChanged();
  }

  async function bulkConfirmAll() {
    if (!window.confirm(`Confirm all ${proposedCount} remaining items as proposed? They will be marked as bulk-confirmed.`)) return;
    setError(null);
    const res = await fetch(`/api/admin/bundles/${bundleId}/bulk-confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, reviewer }),
    });
    if (!res.ok) { setError(`Couldn't confirm the rest: ${await errorText(res)}`); return; }
    await onChanged();
  }

  return (
    <div className="space-y-4">
      {detail.latestOutcome?.noCleanMatch && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No clean match{detail.latestOutcome.note ? `: ${detail.latestOutcome.note}` : ''}
        </p>
      )}
      {POSITIONS.map((pos) => (
        <div key={pos} className="space-y-2">
          <h5 className="text-xs font-medium uppercase text-slate-500">{pos}</h5>
          {(byPosition.get(pos) ?? []).length === 0 && <p className="text-xs text-slate-400">None.</p>}
          {(byPosition.get(pos) ?? []).map((row) => (
            <div key={row.key} className="space-y-1 rounded border border-slate-100 p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{row.label}</span>
                <span className="text-xs text-slate-500">
                  {row.status}{row.aiPosition ? ` · AI: ${row.aiPosition}` : ''}
                </span>
              </div>
              {row.rationale && <p className="text-xs text-slate-600">{row.rationale}</p>}
              {row.reviewNote && <p className="text-xs text-slate-500">Note: {row.reviewNote}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!reviewerReady || row.status !== 'proposed'}
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40"
                  onClick={() => void act(row.ids, 'confirm')}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  disabled={!reviewerReady || row.status !== 'proposed'}
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40"
                  onClick={() => void act(row.ids, 'reject')}
                >
                  Reject
                </button>
                <select
                  disabled={!reviewerReady || row.status !== 'proposed'}
                  defaultValue=""
                  aria-label={`Change position for ${row.label}`}
                  className="rounded border border-slate-300 px-1 py-0.5 text-xs disabled:opacity-40"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) { void changePosition(row.ids, v); e.target.value = ''; }
                  }}
                >
                  <option value="">Change position…</option>
                  {POSITIONS.filter((p) => p !== row.position).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!reviewerReady}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40"
          onClick={() => setShowAdd((s) => !s)}
        >
          Add an item
        </button>
        <button
          type="button"
          disabled={!reviewerReady || proposedCount === 0}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          onClick={() => void bulkConfirmAll()}
        >
          Confirm the rest as proposed
        </button>
      </div>
      {showAdd && <AddItemBox slug={slug} reviewer={reviewer} reviewerReady={reviewerReady} bundleId={bundleId} onAdded={onChanged} />}
      {error && <p className="text-sm text-red-800">{error}</p>}
    </div>
  );
}

function QueueBundleRow({
  slug, reviewer, reviewerReady, bundle, open, detail, error, onToggle, onChanged,
}: {
  slug: string; reviewer: string; reviewerReady: boolean; bundle: BundleListItem; open: boolean;
  detail: BundleDetail | undefined; error: string | undefined; onToggle: () => void; onChanged: () => Promise<void>;
}) {
  return (
    <div className="rounded border border-slate-200">
      <button type="button" className="w-full px-3 py-2 text-left text-sm font-medium" onClick={onToggle}>
        {bundle.name}
      </button>
      {open && (
        <div className="border-t border-slate-200 px-3 py-3">
          {error && <p className="text-sm text-red-800">{error}</p>}
          {!detail && !error && <p className="text-sm text-slate-500">Loading…</p>}
          {detail && (
            <QueueBundleDetail
              slug={slug} reviewer={reviewer} reviewerReady={reviewerReady} bundleId={bundle.id}
              detail={detail} onChanged={onChanged}
            />
          )}
        </div>
      )}
    </div>
  );
}

function AgreementPanel({ agreement, error }: { agreement: AgreementResponse | null; error: string | null }) {
  return (
    <div className="space-y-2 rounded border border-slate-200 p-3">
      <h4 className="text-sm font-medium text-slate-700">Agreement (blind sample)</h4>
      <p className="text-xs text-slate-500">Eight bundles makes percentages rough — read the counts first.</p>
      <p className="text-xs text-slate-500">Nothing is auto-confirmed in P2 regardless of these figures.</p>
      {error && <p className="text-sm text-red-800">{error}</p>}
      {agreement && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-xs">
            <thead className="text-left uppercase text-slate-500">
              <tr>
                <th className="py-1">Bundle</th><th>AI</th><th>Blind</th><th>Both</th><th>Precision</th>
                <th>Recall</th><th>Exact</th><th>±1 (incl. exact)</th><th>Outside top-25</th>
              </tr>
            </thead>
            <tbody>
              {[...agreement.rows, agreement.total].map((r) => (
                <tr key={r.bundleId} className="border-t border-slate-100">
                  <td className="py-1">{r.bundleId}</td><td>{r.aiCount}</td><td>{r.blindCount}</td><td>{r.both}</td>
                  <td>{r.precision === null ? '—' : r.precision.toFixed(2)}</td>
                  <td>{r.recall === null ? '—' : r.recall.toFixed(2)}</td>
                  <td>{r.exact}</td><td>{r.withinOne}</td><td>{r.blindTasksOutsideShortlist}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {agreement && agreement.noMatch.length > 0 && (
        <div>
          <h5 className="text-xs font-medium text-slate-600">No clean match (ESCO to-do)</h5>
          <ul className="text-xs text-slate-500">
            {agreement.noMatch.map((n) => <li key={n.bundleId}>{n.bundleId}{n.note ? `: ${n.note}` : ''}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function QueueTab({
  slug, reviewer, reviewerReady, bundles, progress, details, detailErrors, fetchDetail, onChanged,
}: {
  slug: string; reviewer: string; reviewerReady: boolean; bundles: BundleListItem[]; progress: { reviewed: number; total: number };
  details: Record<string, BundleDetail>; detailErrors: Record<string, string>;
  fetchDetail: (id: string) => Promise<void>; onChanged: (id: string) => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [agreement, setAgreement] = useState<AgreementResponse | null>(null);
  const [agreementError, setAgreementError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/admin/bundles/agreement?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) { setAgreementError(await errorText(res)); return; }
      setAgreement((await res.json()) as AgreementResponse);
    })();
  }, [slug]);

  const locked = bundles.filter((b) => b.sampled && !b.submitted);
  const noMatch = bundles.filter((b) => !(b.sampled && !b.submitted) && b.noCleanMatch === true);
  const normal = bundles.filter((b) => !(b.sampled && !b.submitted) && b.noCleanMatch !== true);

  async function open(id: string) {
    setOpenId(id);
    await fetchDetail(id);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">{progress.reviewed} of {progress.total} bundles reviewed</p>

      <div className="space-y-2">
        {normal.map((b) => (
          <QueueBundleRow
            key={b.id} slug={slug} reviewer={reviewer} reviewerReady={reviewerReady} bundle={b}
            open={openId === b.id} detail={details[b.id]} error={detailErrors[b.id]}
            onToggle={() => (openId === b.id ? setOpenId(null) : void open(b.id))}
            onChanged={() => onChanged(b.id)}
          />
        ))}
        {locked.map((b) => (
          <div key={b.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
            <span className="text-sm font-medium text-slate-500">{b.name}</span>
            <span className="text-xs text-slate-400">Blind pick first</span>
          </div>
        ))}
      </div>

      {noMatch.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-slate-700">No clean match</h4>
          {noMatch.map((b) => (
            <QueueBundleRow
              key={b.id} slug={slug} reviewer={reviewer} reviewerReady={reviewerReady} bundle={b}
              open={openId === b.id} detail={details[b.id]} error={detailErrors[b.id]}
              onToggle={() => (openId === b.id ? setOpenId(null) : void open(b.id))}
              onChanged={() => onChanged(b.id)}
            />
          ))}
        </div>
      )}

      <AgreementPanel agreement={agreement} error={agreementError} />
    </div>
  );
}
