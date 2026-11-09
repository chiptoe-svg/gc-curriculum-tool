import { describe, it, expect } from 'vitest';
import { captureProfileSchema, type CaptureProfile, type CaptureCompetency, type CaptureProfileCitationType } from '@/lib/ai/capture/schema';
import { buildRevisionChanges, applyRevisionDecision, restoreSection, normalizeStatement, overrideReference } from '@/lib/capture/revision-changes';
import { validProfile } from '../../app/capture/fixtures/override-profile';

const NEW_MSG = 'aaaaaaaa-0000-4000-8000-000000000001';
const OLD_MSG = 'bbbbbbbb-0000-4000-8000-000000000002';
const newCite: CaptureProfileCitationType = { type: 'instructor', messageId: NEW_MSG, excerpt: 'we dropped the lab' };
const oldCite: CaptureProfileCitationType = { type: 'instructor', messageId: OLD_MSG, excerpt: 'old answer' };
const staleCite: CaptureProfileCitationType = { type: 'chunk', chunkId: 'stale-chunk', excerpt: 'old syllabus' };

function comp(statement: string, k: number, u: number, d: number, citations: CaptureProfileCitationType[] = [oldCite], rationale = 'r'): CaptureCompetency {
  return {
    statement, type: 'technical', k_depth: k, u_depth: u, d_depth: d,
    evidence_k: 'k', evidence_u: 'u', evidence_d: 'd', rationale,
    source: 'both', citations, k_says: null, u_says: null, d_says: null,
  } as CaptureCompetency;
}
function profile(competencies: CaptureCompetency[], over: Partial<CaptureProfile> = {}): CaptureProfile {
  return { ...validProfile(), competencies, ...over } as CaptureProfile;
}
const isNewCitation = (c: CaptureProfileCitationType) => c.type === 'instructor' && c.messageId === NEW_MSG;
const isStaleCitation = (c: CaptureProfileCitationType) => c.type === 'chunk' && c.chunkId === 'stale-chunk';
const run = (mode: 'targeted' | 'recheck', baseline: CaptureProfile, scored: CaptureProfile) =>
  buildRevisionChanges({ mode, baselineSnapshotId: 'snap-1', baseline, scored, isNewCitation, isStaleCitation });

describe('buildRevisionChanges', () => {
  it('unchanged ratings produce no change', () => {
    const out = run('targeted', profile([comp('A', 2, 2, 2)]), profile([comp('A', 2, 2, 2, [oldCite], 'reworded rationale')]));
    expect(out.revision!.changes).toEqual([]);
    expect(out.revision!.mode).toBe('targeted');
    expect(out.revision!.baseline_snapshot_id).toBe('snap-1');
  });

  it('moved with a new citation is labeled new_evidence and pending in targeted', () => {
    const after = comp('A', 2, 2, 1, [oldCite, newCite]);
    const out = run('targeted', profile([comp('A', 2, 2, 3)]), profile([after]));
    const [c] = out.revision!.changes;
    expect(c).toMatchObject({ statement: 'A', kind: 'moved', label: 'new_evidence', decision: 'pending', dims: [{ dim: 'd', from: 3, to: 1 }] });
    expect(c!.new_citations).toEqual([newCite]);
    expect(out.competencies[0]).toEqual(after);
  });

  it('moved without new evidence is set back in targeted', () => {
    const before = comp('A', 2, 2, 3);
    const out = run('targeted', profile([before]), profile([comp('A', 3, 2, 3, [oldCite], 'other')]));
    const [c] = out.revision!.changes;
    expect(c).toMatchObject({ label: 'no_new_evidence', decision: 'undone', dims: [{ dim: 'k', from: 2, to: 3 }] });
    expect(out.competencies[0]).toEqual(before);
  });

  it('recheck leaves every change pending', () => {
    const after = comp('A', 3, 2, 3);
    const out = run('recheck', profile([comp('A', 2, 2, 3)]), profile([after]));
    expect(out.revision!.changes[0]).toMatchObject({ label: 'no_new_evidence', decision: 'pending' });
    expect(out.competencies[0]).toEqual(after);
  });

  it('added and removed competencies are listed; targeted sets no-evidence ones back', () => {
    const baseline = profile([comp('Keep', 2, 2, 2), comp('Gone', 1, 1, 1)]);
    const scored = profile([comp('Keep', 2, 2, 2), comp('New thing', 2, 1, 1)]);
    const out = run('targeted', baseline, scored);
    const kinds = Object.fromEntries(out.revision!.changes.map(c => [c.statement, c.kind]));
    expect(kinds).toEqual({ 'New thing': 'added', Gone: 'removed' });
    expect(out.competencies.map(c => c.statement).sort()).toEqual(['Gone', 'Keep']);
    const added = out.revision!.changes.find(c => c.kind === 'added')!;
    expect(added.dims).toEqual([{ dim: 'k', from: null, to: 2 }, { dim: 'u', from: null, to: 1 }, { dim: 'd', from: null, to: 1 }]);
  });

  it('an added competency with new evidence stays in, pending', () => {
    const out = run('targeted', profile([comp('Keep', 2, 2, 2)]), profile([comp('Keep', 2, 2, 2), comp('New thing', 2, 1, 1, [newCite])]));
    expect(out.revision!.changes[0]).toMatchObject({ kind: 'added', label: 'new_evidence', decision: 'pending' });
    expect(out.competencies.map(c => c.statement)).toEqual(['Keep', 'New thing']);
  });

  it('normalized match keeps baseline wording and rewrites references', () => {
    const baseline = profile([comp('Color management', 2, 2, 2)]);
    const scored = profile([comp('  color   Management ', 2, 2, 2)], {
      course_emphasis: [{ competency: 'color management', points: 10, share_pct: 100, centrality: 'central' }],
      major_projects: [{ title: 'P', description: 'A ten-char description', competencies: ['COLOR MANAGEMENT'] }] as never,
    });
    const out = run('targeted', baseline, scored);
    expect(out.revision!.changes).toEqual([]);
    expect(out.competencies[0]!.statement).toBe('Color management');
    expect(out.course_emphasis![0]!.competency).toBe('Color management');
    expect(out.major_projects![0]!.competencies).toEqual(['Color management']);
  });

  it('stale citations are listed', () => {
    const out = run('targeted', profile([comp('A', 2, 2, 2, [staleCite])]), profile([comp('A', 2, 2, 2, [staleCite])]));
    expect(out.revision!.stale_evidence).toEqual(['A']);
  });

  it('changed sections carry the baseline value', () => {
    const baseline = profile([comp('A', 2, 2, 2)], { revised_objectives_draft: ['old'] });
    const scored = profile([comp('A', 2, 2, 2)], { revised_objectives_draft: ['new'] });
    const out = run('targeted', baseline, scored);
    expect(out.revision!.changed_sections).toEqual([{ section: 'revised_objectives_draft', before: ['old'] }]);
    expect(out.revised_objectives_draft).toEqual(['new']);
  });
});

describe('applyRevisionDecision and restoreSection', () => {
  it('undo then keep restores after', () => {
    const before = comp('A', 2, 2, 3);
    const after = comp('A', 2, 2, 1, [newCite]);
    const built = run('targeted', profile([before]), profile([after]));
    const undone = applyRevisionDecision(built, 'A', 'undone');
    expect(undone.competencies[0]).toEqual(before);
    expect(undone.revision!.changes[0]!.decision).toBe('undone');
    const kept = applyRevisionDecision(undone, 'A', 'kept');
    expect(kept.competencies[0]).toEqual(after);
    expect(kept.revision!.changes[0]!.decision).toBe('kept');
  });

  it('keeping a removal removes the competency; undoing restores it', () => {
    const built = run('recheck', profile([comp('Keep', 2, 2, 2), comp('Gone', 1, 1, 1)]), profile([comp('Keep', 2, 2, 2)]));
    expect(built.competencies.map(c => c.statement)).toEqual(['Keep']);
    const undone = applyRevisionDecision(built, 'Gone', 'undone');
    expect(undone.competencies.map(c => c.statement)).toEqual(['Keep', 'Gone']);
    expect(applyRevisionDecision(undone, 'Gone', 'kept').competencies.map(c => c.statement)).toEqual(['Keep']);
  });

  it('restoreSection puts the baseline back', () => {
    const built = run('targeted', profile([comp('A', 2, 2, 2)], { revised_objectives_draft: ['old'] }), profile([comp('A', 2, 2, 2)], { revised_objectives_draft: ['new'] }));
    const restored = restoreSection(built, 'revised_objectives_draft');
    expect(restored.revised_objectives_draft).toEqual(['old']);
    expect(restored.revision!.changed_sections).toEqual([]);
  });

  it('normalizeStatement trims, lowercases and collapses spaces', () => {
    expect(normalizeStatement('  Color   Management ')).toBe('color management');
  });
});

describe('overrideReference', () => {
  it('without a revision it is the loaded competencies', () => {
    const p = profile([comp('A', 2, 2, 2)]);
    expect(overrideReference(p, p)).toEqual(p.competencies);
  });

  it('a kept change is compared with its re-scored version, so keeping it is not a raise', () => {
    const built = run('targeted', profile([comp('A', 2, 2, 1)]), profile([comp('A', 2, 2, 3, [newCite])]));
    const loaded = applyRevisionDecision(built, 'A', 'undone');
    const working = applyRevisionDecision(loaded, 'A', 'kept');
    expect(overrideReference(loaded, working)[0]!.d_depth).toBe(3);
  });

  it('aligns by statement after a removal is undone (appended at the end)', () => {
    const built = run('recheck', profile([comp('Keep', 2, 2, 2), comp('Gone', 1, 1, 1)]), profile([comp('Keep', 2, 2, 2)]));
    const working = applyRevisionDecision(built, 'Gone', 'undone');
    expect(overrideReference(built, working).map(c => c.statement)).toEqual(['Keep', 'Gone']);
  });
});

describe('schema', () => {
  it('accepts a profile with revision and one without', () => {
    const built = run('targeted', profile([comp('A', 2, 2, 3)]), profile([comp('A', 2, 2, 1, [newCite])]));
    expect(captureProfileSchema.parse(built).revision!.changes).toHaveLength(1);
    expect(captureProfileSchema.parse(validProfile()).revision).toBeUndefined();
  });
});
