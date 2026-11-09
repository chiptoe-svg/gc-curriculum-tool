import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CaptureCompetency, Revision } from '@/lib/ai/capture/schema';
import { RevisionChanges, revisionBlocksApproval, REVISION_BLOCKED_MESSAGE } from '@/app/capture/[code]/RevisionChanges';

const comp = (statement: string, d: number) => ({
  statement, type: 'technical', k_depth: 2, u_depth: 2, d_depth: d, evidence_k: 'k', evidence_u: 'u', evidence_d: 'd', rationale: 'r', citations: [],
}) as unknown as CaptureCompetency;
const change = (statement: string, label: 'new_evidence' | 'no_new_evidence', decision: 'pending' | 'kept' | 'undone') => ({
  statement, kind: 'moved' as const, label, dims: [{ dim: 'd' as const, from: 3, to: 2 }],
  new_citations: label === 'new_evidence' ? [{ type: 'instructor' as const, messageId: 'aaaaaaaa', excerpt: 'We dropped the lab' }] : [],
  before: comp(statement, 3), after: comp(statement, 2), decision,
});
function revision(over: Partial<Revision> = {}): Revision {
  return {
    mode: 'targeted', baseline_snapshot_id: 's',
    changes: [change('Ink film', 'new_evidence', 'pending'), change('Color', 'no_new_evidence', 'undone'), change('Press', 'no_new_evidence', 'undone')],
    stale_evidence: ['Prepress'], changed_sections: [{ section: 'revised_objectives_draft', before: ['old'] }],
    ...over,
  };
}
function setup(rev = revision()) {
  const onDecide = vi.fn(); const onDecideGroup = vi.fn(); const onRestoreSection = vi.fn();
  render(<RevisionChanges revision={rev} onDecide={onDecide} onDecideGroup={onDecideGroup} onRestoreSection={onRestoreSection} />);
  return { onDecide, onDecideGroup, onRestoreSection };
}

describe('RevisionChanges', () => {
  it('lists changes in the three groups with the fixed headings', () => {
    setup();
    expect(screen.getByText('Changes with new evidence')).toBeTruthy();
    expect(screen.getByText('Changes without new evidence — likely AI variation')).toBeTruthy();
    expect(screen.getByText('Evidence no longer in use — check these')).toBeTruthy();
    expect(screen.getByText('Ink film')).toBeTruthy();
    expect(screen.getAllByText('D 3 → 2')).toHaveLength(3);
    expect(screen.getByText(/We dropped the lab/)).toBeTruthy();
    expect(screen.getByText('Prepress')).toBeTruthy();
  });

  it('undo and keep report the decision for that change', () => {
    const { onDecide } = setup();
    const undo = screen.getAllByRole('button', { name: 'Undo' })[0]!;
    expect(undo.getAttribute('title')).toBe('Restores the approved version of this competency, replacing any edits you made to it.');
    fireEvent.click(undo);
    expect(onDecide).toHaveBeenCalledWith('Ink film', 'undone');
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep change' })[0]!);
    expect(onDecide).toHaveBeenCalledWith('Ink film', 'kept');
  });

  it('group button applies to the no-evidence group only', () => {
    const { onDecideGroup } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Keep all as set back' }));
    expect(onDecideGroup).toHaveBeenCalledWith('undone');
    const { onDecideGroup: g2 } = (() => { document.body.innerHTML = ''; return setup(revision({ mode: 'recheck' })); })();
    fireEvent.click(screen.getByRole('button', { name: 'Undo all' }));
    expect(g2).toHaveBeenCalledWith('undone');
  });

  it('restore approved version puts a changed section back', () => {
    const { onRestoreSection } = setup();
    expect(screen.getByText('Changed since the approved version')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore approved version' }));
    expect(onRestoreSection).toHaveBeenCalledWith('revised_objectives_draft');
  });
});

describe('approval gate', () => {
  it('approve is blocked while a change is pending, with the fixed message', () => {
    expect(revisionBlocksApproval(revision())).toBe(true);
    expect(REVISION_BLOCKED_MESSAGE).toBe('Decide on each change above first.');
  });

  it('targeted no-evidence changes count as decided', () => {
    const rev = revision({ changes: [change('Color', 'no_new_evidence', 'undone'), change('Ink', 'new_evidence', 'kept')] });
    expect(revisionBlocksApproval(rev)).toBe(false);
    expect(revisionBlocksApproval(null)).toBe(false);
  });
});
