// Owner, 2026-10-07: courses are added only from the admin access page, so the
// faculty course list no longer shows "+ Add a course" / "Preload courses".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('/courses', () => {
  it('does not render the roster add/preload controls', () => {
    const src = readFileSync('app/courses/CoursesIndex.tsx', 'utf8');
    expect(src).not.toMatch(/CourseRosterControls/);
  });
});
