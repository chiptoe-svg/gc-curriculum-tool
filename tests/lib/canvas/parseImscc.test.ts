import { describe, it, expect } from 'vitest';
import { parseImscc } from '@/lib/canvas/parseImscc';
describe('parseImscc', () => {
  it('parses the fixture cartridge into CanvasCourseData + filtered files', async () => {
    const { data, files } = await parseImscc('tests/fixtures/sample.imscc');
    expect(data.course.syllabusHtml).toContain('Course goals');
    expect(data.pages).toHaveLength(1);
    expect(data.pages[0]!.title).toBe('Welcome');
    expect(data.assignments).toHaveLength(1);
    expect(data.assignments[0]!.name).toBe('Project 1');
    expect(data.quizzes).toHaveLength(1);
    expect(data.quizzes[0]!.questions).toHaveLength(2);
    expect(data.modules).toHaveLength(1);
    expect(files.map(f => f.name)).toContain('reading.pdf');
    expect(files.some(f => f.name.endsWith('.png'))).toBe(false);
  });
  it('rejects a non-cartridge zip (no imsmanifest.xml)', async () => {
    await expect(parseImscc('tests/fixtures/imscc-src/quiz1/assessment.xml')).rejects.toThrow(/manifest|cartridge|zip/i);
  });
});
