import { describe, it, expect } from 'vitest';
import { decideGuideSection } from '../objective-guide-section';
import type { StoredObjectiveGuide } from '@/lib/db/objective-guides-queries';

const course = { code: 'MKT 4320', title: 'Brand Management' };
const guide = { intro: 'Intro.', objectives: [], checklist: [] };
const stored: StoredObjectiveGuide = {
  courseCode: 'MKT 4320', snapshotId: 'snap-1', guide, droppedNames: [], model: 'gpt-test',
  generatedAt: new Date('2026-10-06T12:00:00Z'), snapshotCreatedAt: new Date('2026-10-05T15:00:00Z'),
};

describe('decideGuideSection', () => {
  it('shows the stored guide with its capture date and plain text', () => {
    const s = decideGuideSection({ course, stored, hasSnapshot: true, syllabus: { status: 'no-syllabus' } });
    expect(s).toMatchObject({ kind: 'guide', guide, capturedOn: '2026-10-05' });
    expect(s && s.kind === 'guide' && s.text.startsWith('Assessing the course objectives: MKT 4320 Brand Management')).toBe(true);
  });

  it('falls back to the generation date when the snapshot is gone', () => {
    const s = decideGuideSection({ course, stored: { ...stored, snapshotCreatedAt: null }, hasSnapshot: true, syllabus: { status: 'no-syllabus' } });
    expect(s).toMatchObject({ kind: 'guide', capturedOn: '2026-10-06' });
  });

  it('tells a captured course with no syllabus to provide one', () => {
    expect(decideGuideSection({ course, stored: null, hasSnapshot: true, syllabus: { status: 'no-syllabus' } })).toEqual({ kind: 'no-syllabus' });
  });

  it('tells a captured course whose syllabus is set aside to include it', () => {
    expect(decideGuideSection({ course, stored: null, hasSnapshot: true, syllabus: { status: 'syllabus-set-aside' } })).toEqual({ kind: 'syllabus-set-aside' });
  });

  it('omits the section for uncaptured courses and for a guide not yet built', () => {
    expect(decideGuideSection({ course, stored: null, hasSnapshot: false, syllabus: { status: 'no-syllabus' } })).toBeNull();
    expect(decideGuideSection({ course, stored: null, hasSnapshot: true, syllabus: { status: 'ok', syllabi: [{ id: 's', fileName: 'f', text: 't' }] } })).toBeNull();
  });
});
