import { describe, it, expect } from 'vitest';
import { planCanvasFiles } from '@/lib/canvas/canvas-file-plan';
import type { CanvasModule } from '@/lib/canvas/fetchCanvasCourse';

const item = (title: string, type: string, fileId: string | null = null) =>
  ({ title, type, externalUrl: null, htmlUrl: null, published: true, fileId });

const modules: CanvasModule[] = [
  { id: '1', name: 'Course Information', published: true, items: [
    item('PKSC 2200 Syllabi', 'File', '901'),
    item('Tentative Course Outline - Spring 2026.pdf', 'File', '902'),
    item('Simple Syllabus Link', 'ExternalUrl'),
    item('Clean Up Requirement', 'Page'),
  ] },
];

/** Files placed straight into a Canvas module were never downloaded: only
 *  /files/{id} links inside the syllabus page or assignment text were
 *  (PKSC 2200, 2026-10-28: the syllabus PDF sat in "Course Information"). */
describe('planCanvasFiles', () => {
  it('takes the files placed in modules, not just the ones linked from text', () => {
    const plan = planCanvasFiles('', modules);
    expect(plan.ids).toEqual(['901', '902']);
  });

  it('adds files linked from text after the module files, without repeats', () => {
    const text = 'see <a href="/courses/5/files/902/download">outline</a> and /files/777?wrap=1';
    expect(planCanvasFiles(text, modules).ids).toEqual(['901', '902', '777']);
  });

  it('names every file left over the limit instead of dropping it silently', () => {
    const plan = planCanvasFiles('/files/777/', modules, 1);
    expect(plan.ids).toEqual(['901']);
    expect(plan.overLimit).toEqual([
      { id: '902', name: 'Tentative Course Outline - Spring 2026.pdf' },
      { id: '777', name: 'Canvas file 777' },
    ]);
  });

  it('allows far more than 20 files by default', () => {
    const many = Array.from({ length: 120 }, (_, i) => `/files/${1000 + i}/`).join(' ');
    const plan = planCanvasFiles(many, []);
    expect(plan.ids).toHaveLength(120);
    expect(plan.overLimit).toEqual([]);
  });
});
