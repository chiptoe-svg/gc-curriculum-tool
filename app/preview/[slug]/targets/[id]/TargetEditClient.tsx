'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { CareerTarget, SubCompetency } from '@/lib/domain/types';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SubCompRow extends SubCompetency {
  editing: boolean;
  editName: string;
  editKnow: string;
  editUnderstand: string;
  editDo: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function arrayEditor(
  label: string,
  values: string[],
  onChange: (updated: string[]) => void,
  multiline = false
) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      {values.map((v, i) => (
        <div key={i} className="flex gap-2 items-start">
          {multiline ? (
            <Textarea
              className="flex-1 text-sm resize-none"
              rows={2}
              value={v}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
          ) : (
            <Input
              className="flex-1 text-sm"
              value={v}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
          )}
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            disabled={values.length <= 1}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => onChange([...values, ''])}
      >
        + Add row
      </Button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function TargetEditClient({ slug, targetId }: { slug: string; targetId: string }) {
  const [target, setTarget] = useState<CareerTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Top-level editable fields
  const [name, setName] = useState('');
  const [shortDef, setShortDef] = useState('');
  const [industryContexts, setIndustryContexts] = useState<string[]>([]);
  const [knowDescs, setKnowDescs] = useState<string[]>([]);
  const [understandDescs, setUnderstandDescs] = useState<string[]>([]);
  const [doDescs, setDoDescs] = useState<string[]>([]);
  const [defensibility, setDefensibility] = useState('');
  const [socCode, setSocCode] = useState('');

  // Sub-competency rows
  const [subRows, setSubRows] = useState<SubCompRow[]>([]);

  // New sub-competency form
  const [showNewSc, setShowNewSc] = useState(false);
  const [newScName, setNewScName] = useState('');
  const [newScKnow, setNewScKnow] = useState('');
  const [newScUnderstand, setNewScUnderstand] = useState('');
  const [newScDo, setNewScDo] = useState('');

  // Toast / save state
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const loadTarget = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/targets/${targetId}`);
      if (!r.ok) {
        if (r.status === 404) {
          setError('Career target not found.');
        } else {
          setError('Failed to load target.');
        }
        return;
      }
      const t: CareerTarget = await r.json();
      setTarget(t);
      setName(t.name);
      setShortDef(t.shortDefinition);
      setIndustryContexts(t.industryContexts);
      setKnowDescs(t.knowDescriptors);
      setUnderstandDescs(t.understandDescriptors);
      setDoDescs(t.doDescriptors);
      setDefensibility(t.defensibilityNote);
      setSocCode(t.socCode ?? '');
      setSubRows(
        t.subCompetencies.map((sc) => ({
          ...sc,
          editing: false,
          editName: sc.name,
          editKnow: sc.knowDescriptor,
          editUnderstand: sc.understandDescriptor,
          editDo: sc.doDescriptor,
        }))
      );
    } catch {
      setError('Failed to load target.');
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  useEffect(() => {
    loadTarget();
  }, [loadTarget]);

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleSaveTarget() {
    setSaving(true);
    try {
      const r = await fetch(`/api/targets/${targetId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          shortDefinition: shortDef,
          industryContexts,
          knowDescriptors: knowDescs,
          understandDescriptors: understandDescs,
          doDescriptors: doDescs,
          defensibilityNote: defensibility,
          socCode: socCode.trim() || null,
        }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        showToast('error', b.error ?? 'Save failed');
      } else {
        showToast('success', 'Saved successfully');
      }
    } catch {
      showToast('error', 'Network error — changes not saved');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSubComp(scId: string, i: number) {
    const row = subRows[i]!;
    const r = await fetch(`/api/targets/${targetId}/sub-competencies/${scId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: row.editName,
        knowDescriptor: row.editKnow,
        understandDescriptor: row.editUnderstand,
        doDescriptor: row.editDo,
      }),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      showToast('error', b.error ?? 'Save failed');
    } else {
      showToast('success', 'Sub-competency saved');
      setSubRows((prev) =>
        prev.map((s, j) =>
          j === i
            ? {
                ...s,
                name: s.editName,
                knowDescriptor: s.editKnow,
                understandDescriptor: s.editUnderstand,
                doDescriptor: s.editDo,
                editing: false,
              }
            : s
        )
      );
    }
  }

  async function handleRetireSubComp(scId: string) {
    if (!confirm(`Retire sub-competency "${scId}"? This cannot be undone from this UI.`)) return;
    const r = await fetch(`/api/targets/${targetId}/sub-competencies/${scId}/retire`, {
      method: 'POST',
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      showToast('error', b.error ?? 'Retire failed');
    } else {
      showToast('success', 'Sub-competency retired');
      setSubRows((prev) => prev.filter((s) => s.id !== scId));
    }
  }

  async function handleReorder(from: number, to: number) {
    const next = [...subRows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setSubRows(next);
    const order = next.map((s) => s.id);
    const r = await fetch(`/api/targets/${targetId}/sub-competencies/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order }),
    });
    if (!r.ok) {
      showToast('error', 'Reorder failed');
    }
  }

  async function handleCreateSubComp() {
    if (!newScName.trim() || !newScKnow.trim() || !newScUnderstand.trim() || !newScDo.trim()) {
      showToast('error', 'All fields required');
      return;
    }
    const r = await fetch(`/api/targets/${targetId}/sub-competencies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: newScName,
        knowDescriptor: newScKnow,
        understandDescriptor: newScUnderstand,
        doDescriptor: newScDo,
      }),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      showToast('error', b.error ?? 'Create failed');
    } else {
      const created = await r.json();
      showToast('success', 'Sub-competency created');
      setSubRows((prev) => [
        ...prev,
        {
          id: created.id,
          name: created.name,
          knowDescriptor: created.knowDescriptor,
          understandDescriptor: created.understandDescriptor,
          doDescriptor: created.doDescriptor,
          editing: false,
          editName: created.name,
          editKnow: created.knowDescriptor,
          editUnderstand: created.understandDescriptor,
          editDo: created.doDescriptor,
        },
      ]);
      setNewScName('');
      setNewScKnow('');
      setNewScUnderstand('');
      setNewScDo('');
      setShowNewSc(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl p-6 md:p-12">
        <p className="text-muted-foreground">Loading...</p>
      </main>
    );
  }

  if (error || !target) {
    return (
      <main className="mx-auto max-w-4xl p-6 md:p-12 space-y-4">
        <Link href={`/preview/${slug}/targets`} className="text-sm underline underline-offset-2 text-muted-foreground">
          &larr; Back to targets
        </Link>
        <div className="rounded border border-destructive bg-destructive/5 text-destructive p-4 text-sm">
          {error ?? 'Target not found.'}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-6 md:p-12 space-y-8">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 rounded-md px-4 py-3 text-sm shadow-lg transition-opacity ${
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-destructive text-destructive-foreground'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/preview/${slug}`} className="underline underline-offset-2 hover:text-foreground">
          Prototype
        </Link>
        <span>/</span>
        <Link href={`/preview/${slug}/targets`} className="underline underline-offset-2 hover:text-foreground">
          Career Targets
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{target.name}</span>
      </div>

      {/* Target fields */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Edit target
            <Badge variant="outline" className="text-xs font-mono">{targetId}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="target-name">Name</Label>
            <Input id="target-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="target-shortdef">Short definition</Label>
            <Textarea
              id="target-shortdef"
              rows={3}
              value={shortDef}
              onChange={(e) => setShortDef(e.target.value)}
            />
          </div>

          {arrayEditor('Industry contexts', industryContexts, setIndustryContexts)}
          {arrayEditor('Know descriptors', knowDescs, setKnowDescs, true)}
          {arrayEditor('Understand descriptors', understandDescs, setUnderstandDescs, true)}
          {arrayEditor('Do descriptors', doDescs, setDoDescs, true)}

          <div className="space-y-2">
            <Label htmlFor="target-defensibility">Defensibility note</Label>
            <Textarea
              id="target-defensibility"
              rows={4}
              value={defensibility}
              onChange={(e) => setDefensibility(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="target-soc">SOC code (optional)</Label>
            <Input
              id="target-soc"
              placeholder="e.g. 11-3051.00"
              value={socCode}
              onChange={(e) => setSocCode(e.target.value)}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button onClick={handleSaveTarget} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            <Button variant="outline" onClick={loadTarget} disabled={saving}>
              Discard
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sub-competencies */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">
          Sub-competencies{' '}
          <span className="text-sm font-normal text-muted-foreground">({subRows.length})</span>
        </h2>

        {subRows.map((sc, i) => (
          <Card key={sc.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">{sc.name}</CardTitle>
                  <Badge variant="outline" className="text-xs font-mono">{sc.id}</Badge>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Up / Down reorder */}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={i === 0}
                    onClick={() => handleReorder(i, i - 1)}
                    aria-label="Move up"
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={i === subRows.length - 1}
                    onClick={() => handleReorder(i, i + 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSubRows((prev) =>
                        prev.map((s, j) => (j === i ? { ...s, editing: !s.editing } : s))
                      )
                    }
                  >
                    {sc.editing ? 'Cancel' : 'Edit'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive hover:bg-destructive/10"
                    onClick={() => handleRetireSubComp(sc.id)}
                  >
                    Retire
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {sc.editing ? (
                <>
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={sc.editName}
                      onChange={(e) =>
                        setSubRows((prev) =>
                          prev.map((s, j) => (j === i ? { ...s, editName: e.target.value } : s))
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Know descriptor</Label>
                    <Textarea
                      rows={2}
                      value={sc.editKnow}
                      onChange={(e) =>
                        setSubRows((prev) =>
                          prev.map((s, j) => (j === i ? { ...s, editKnow: e.target.value } : s))
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Understand descriptor</Label>
                    <Textarea
                      rows={2}
                      value={sc.editUnderstand}
                      onChange={(e) =>
                        setSubRows((prev) =>
                          prev.map((s, j) =>
                            j === i ? { ...s, editUnderstand: e.target.value } : s
                          )
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Do descriptor</Label>
                    <Textarea
                      rows={2}
                      value={sc.editDo}
                      onChange={(e) =>
                        setSubRows((prev) =>
                          prev.map((s, j) => (j === i ? { ...s, editDo: e.target.value } : s))
                        )
                      }
                    />
                  </div>
                  <Button size="sm" onClick={() => handleSaveSubComp(sc.id, i)}>
                    Save sub-competency
                  </Button>
                </>
              ) : (
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Know</dt>
                    <dd className="mt-0.5 leading-relaxed">{sc.knowDescriptor}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Understand</dt>
                    <dd className="mt-0.5 leading-relaxed">{sc.understandDescriptor}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Do</dt>
                    <dd className="mt-0.5 leading-relaxed">{sc.doDescriptor}</dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Add new sub-competency */}
        {showNewSc ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">New sub-competency</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="e.g. Brand Voice"
                  value={newScName}
                  onChange={(e) => setNewScName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Know descriptor</Label>
                <Textarea
                  rows={2}
                  placeholder="Knows..."
                  value={newScKnow}
                  onChange={(e) => setNewScKnow(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Understand descriptor</Label>
                <Textarea
                  rows={2}
                  placeholder="Understands why..."
                  value={newScUnderstand}
                  onChange={(e) => setNewScUnderstand(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Do descriptor</Label>
                <Textarea
                  rows={2}
                  placeholder="Produces / manages / evaluates..."
                  value={newScDo}
                  onChange={(e) => setNewScDo(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <Button onClick={handleCreateSubComp}>Create</Button>
                <Button variant="outline" onClick={() => setShowNewSc(false)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Button variant="outline" onClick={() => setShowNewSc(true)}>
            + Add sub-competency
          </Button>
        )}
      </section>
    </main>
  );
}
