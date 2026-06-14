import { describe, it, expect } from 'vitest';
import { profileToOkfMarkdown } from '@/lib/okf/profile-to-okf';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

const profile = {
  course_code: 'GC 4800', scale_version: 'v1', generated_at: 'now',
  overview: { narrative: 'A capstone in production.', at_a_glance: [], who_for: '', arc: '' },
  competencies: [
    { statement: 'Color management', type: 'technical', k_depth: 3, u_depth: 3, d_depth: 4, evidence_k: 'k', evidence_u: 'u', evidence_d: 'measured color in the press lab', source: 'materials', citations: [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: 'rubric' }] },
    { statement: 'Curiosity', type: 'foundational', k_depth: null, u_depth: null, d_depth: 3, evidence_k: null, evidence_u: null, evidence_d: 'reflection', source: 'instructor' },
  ],
  incoming_expectations: [{ statement: 'Spot color basics', expected_depth: { k: 2, u: null, d: 3 }, evidenced_by: ['x'], confidence: 'low', source: 'materials' }],
  verification_summary: { course_shape: 'A production capstone.', strongest_evidence: ['press-lab artifacts'], dimensional_patterns: [], catalog_vs_evidence: [] },
  audit_notes: {}, revised_objectives_draft: ['Students produce print-ready artwork'],
  course_emphasis: [{ competency: 'Color management', points: 120, share_pct: 40, centrality: 'central' }],
  class_structure: { topics: ['Color', 'Prepress'], cadence: 'weekly 2-hour lab', assessment: 'Two projects + a final.' },
  major_projects: [{ title: 'Brand Color Report', description: 'Measure color across media.', competencies: ['Color management'] }],
} as unknown as CaptureProfile;

const args = {
  course: { code: 'GC 4800', title: 'Capstone', prefix: 'GC', level: 4, track: 'print', buildsToCareer: true, catalogUrl: 'https://catalog/gc4800' },
  profile,
  snapshot: { id: 'snap-123', createdAt: new Date('2026-06-14T00:00:00.000Z'), instructorName: 'Dr. X' },
  viewUrl: 'http://host/view/GC%204800',
};

describe('profileToOkfMarkdown', () => {
  const md = profileToOkfMarkdown(args);
  it('emits OKF v0.1 frontmatter with type: course + required keys', () => {
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toMatch(/^type: course$/m);
    expect(md).toMatch(/^title: ".*Capstone.*"$/m);
    expect(md).toMatch(/^timestamp: 2026-06-14T00:00:00.000Z$/m);
    expect(md).toMatch(/^snapshot_id: snap-123$/m);
    expect(md).toMatch(/^slug: gc-4800$/m);
    expect(md).toMatch(/resource:/);
    expect(md).toMatch(/tags: \[.*builds-to-career.*\]/);
  });
  it('renders all populated sections with K/U/D + band marker', () => {
    expect(md).toContain('## Apparent outcomes');
    expect(md).toContain('Students produce print-ready artwork');
    expect(md).toContain('## Competencies developed');
    expect(md).toContain('Color management');
    expect(md).toContain('·materials');
    expect(md).toContain('## Incoming expectations');
    expect(md).toContain('Spot color basics');
    expect(md).toContain('## Class structure');
    expect(md).toContain('weekly 2-hour lab');
    expect(md).toContain('## Major projects');
    expect(md).toContain('Brand Color Report');
    expect(md).toContain('## Course emphasis');
    expect(md).toContain('## Citations');
    expect(md).toContain('snap-123');
  });
  it('omits K/U for a foundational competency', () => {
    const curiosityLine = md.split('\n').find(l => l.includes('Curiosity'))!;
    expect(curiosityLine).toContain('D3');
    expect(curiosityLine).not.toMatch(/K\d/);
  });
  it('omits sections whose fields are null/empty', () => {
    const lean = profileToOkfMarkdown({ ...args, profile: { ...profile, class_structure: null, major_projects: null, course_emphasis: null, revised_objectives_draft: null } as unknown as CaptureProfile });
    expect(lean).not.toContain('## Class structure');
    expect(lean).not.toContain('## Major projects');
    expect(lean).not.toContain('## Course emphasis');
    expect(lean).not.toContain('## Apparent outcomes');
  });
});
