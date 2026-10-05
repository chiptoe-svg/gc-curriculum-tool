import { describe, it, expect } from 'vitest';
import { assembleCanvasMaterials } from '@/lib/canvas/assemble-canvas-materials';
const EMPTY = { course: { id: '1', name: 'C', syllabusHtml: '' }, assignments: [], modules: [], pages: [], discussions: [], quizzes: [] } as any;
describe('assembleCanvasMaterials', () => {
  it('always emits Canvas: Syllabus when Canvas has a syllabus page (the syllabus is the objective source)', () => {
    const out = assembleCanvasMaterials({ ...EMPTY, course: { id: '1', name: 'C', syllabusHtml: '<p>Hi</p>' } });
    expect(out.map(m => m.fileName)).toContain('Canvas: Syllabus');
  });
  it('emits no syllabus material when the Canvas syllabus page is empty', () => {
    const out = assembleCanvasMaterials(EMPTY);
    expect(out.map(m => m.fileName)).not.toContain('Canvas: Syllabus');
  });
});
