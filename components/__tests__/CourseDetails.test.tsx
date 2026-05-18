import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CourseDetails, type CourseDetailFields } from '@/components/CourseDetails';
import { useState } from 'react';

const ORIGINAL: CourseDetailFields = {
  description: 'orig desc',
  prerequisites: 'GC 0000',
  learningObjectives: ['a', 'b'],
  majorProjects: ['p1'],
  skillsRequired: ['s1'],
};

function Harness() {
  const [current, setCurrent] = useState<CourseDetailFields>(ORIGINAL);
  return (
    <CourseDetails
      original={ORIGINAL}
      current={current}
      onChange={setCurrent}
      onReset={() => setCurrent(ORIGINAL)}
    />
  );
}

describe('CourseDetails', () => {
  it('shows no Edited badges when current matches original', () => {
    render(<Harness />);
    expect(screen.queryByText('Edited')).toBeNull();
  });

  it('shows Edited badge when description is changed and resets via the link', () => {
    render(<Harness />);
    const ta = screen.getByLabelText(/Description/i);
    fireEvent.change(ta, { target: { value: 'changed' } });
    expect(screen.getAllByText('Edited').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(/Reset all fields/i));
    expect(screen.queryByText('Edited')).toBeNull();
  });
});
