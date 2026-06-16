import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/faculty', () => ({ FACULTY_ROSTER: ['Alice Appleton', 'Bob Brennan', 'Department canonical'] }));

import { InstructorSelect } from '@/app/capture/[code]/InstructorSelect';

describe('InstructorSelect', () => {
  it('renders the roster plus an "Add a new name" option', () => {
    render(<InstructorSelect value="Alice Appleton" onChange={() => {}} />);
    expect(screen.getByRole('option', { name: 'Alice Appleton' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Add a new name/i })).toBeTruthy();
  });

  it('switching to "Add a new name" reveals a text input and typing fires onChange', () => {
    const onChange = vi.fn();
    render(<InstructorSelect value="Alice Appleton" onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__add_new__' } });
    // picking add-new clears the value, then the input appears
    expect(onChange).toHaveBeenLastCalledWith('');
    const input = screen.getByLabelText(/New instructor name/i);
    fireEvent.change(input, { target: { value: 'Jordan Lee' } });
    expect(onChange).toHaveBeenLastCalledWith('Jordan Lee');
  });

  it('shows a custom (off-roster) value as a "(new)" option in the dropdown', () => {
    render(<InstructorSelect value="Jordan Lee" onChange={() => {}} />);
    expect(screen.getByRole('option', { name: /Jordan Lee \(new\)/ })).toBeTruthy();
  });

  it('a roster value selects normally without a "(new)" option', () => {
    render(<InstructorSelect value="Bob Brennan" onChange={() => {}} />);
    expect(screen.queryByRole('option', { name: /\(new\)/ })).toBeNull();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('Bob Brennan');
  });
});
