import { describe, it, expect } from 'vitest';
import { assembleCanvasMaterials } from '@/lib/canvas/assemble-canvas-materials';
const EMPTY = { course: { id: '1', name: 'C', syllabusHtml: '' }, assignments: [], modules: [], pages: [], discussions: [], quizzes: [] } as any;
describe('assembleCanvasMaterials', () => {
  it('emits Canvas: Syllabus when syllabus present and the Sheet has no LOs', () => {
    const out = assembleCanvasMaterials({ ...EMPTY, course: { id: '1', name: 'C', syllabusHtml: '<p>Hi</p>' } }, { sheetsHasCatalog: false });
    expect(out.map(m => m.fileName)).toContain('Canvas: Syllabus');
  });
  it('suppresses Canvas: Syllabus when the Sheet already has LOs', () => {
    const out = assembleCanvasMaterials({ ...EMPTY, course: { id: '1', name: 'C', syllabusHtml: '<p>Hi</p>' } }, { sheetsHasCatalog: true });
    expect(out.map(m => m.fileName)).not.toContain('Canvas: Syllabus');
  });
});
