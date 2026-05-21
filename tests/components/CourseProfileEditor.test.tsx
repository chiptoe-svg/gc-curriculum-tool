import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CourseProfileEditor } from '@/components/CourseProfileEditor';

// Stub fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});

const baseProfile = {
  summary: 'A course about print production.',
  learningObjectives: ['Understand color theory', 'Operate a digital press'],
  skills: ['RIP software', 'PDF preflight'],
  competencies: [
    {
      name: 'Color Management',
      description: 'Profile and calibrate press output.',
      level: 'developed',
      evidence: [{ fileName: 'rubric.pdf', quote: 'Students will profile a press.' }],
    },
  ],
  catalogDivergence: {
    reinforced: ['Color theory'],
    additions: ['Press calibration'],
    gaps: [],
  },
};

describe('CourseProfileEditor', () => {
  it('renders the summary textarea with initial value', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    expect(screen.getByDisplayValue('A course about print production.')).toBeDefined();
  });

  it('renders learning objectives as editable inputs', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    expect(screen.getByDisplayValue('Understand color theory')).toBeDefined();
    expect(screen.getByDisplayValue('Operate a digital press')).toBeDefined();
  });

  it('adds a new learning objective when clicking Add', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    const addButtons = screen.getAllByText('+ Add');
    fireEvent.click(addButtons[0]!);
    const inputs = screen.getAllByPlaceholderText('Learning objective');
    expect(inputs.length).toBe(3);
  });

  it('removes a learning objective when clicking Remove', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    const removeButtons = screen.getAllByText('Remove');
    fireEvent.click(removeButtons[0]!);
    expect(screen.queryByDisplayValue('Understand color theory')).toBeNull();
  });

  it('shows competency name, description, and level as editable inputs', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    expect(screen.getByDisplayValue('Color Management')).toBeDefined();
    expect(screen.getByDisplayValue('Profile and calibrate press output.')).toBeDefined();
    expect(screen.getByDisplayValue('developed')).toBeDefined();
  });

  it('shows evidence quote as read-only text (not an input)', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    expect(screen.getByText('Students will profile a press.')).toBeDefined();
    const allInputValues = screen.queryAllByDisplayValue('Students will profile a press.');
    expect(allInputValues).toHaveLength(0);
  });

  it('shows catalogDivergence as a read-only panel', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    expect(screen.getByText('Color theory')).toBeDefined();
    expect(screen.getByText('Press calibration')).toBeDefined();
  });

  it('calls PATCH on Save and shows success toast', async () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/courses/GC%201010/profile?slug=test-slug');
    expect(opts.method).toBe('PATCH');
    const sentBody = JSON.parse(opts.body as string);
    expect(sentBody.summary).toBe('A course about print production.');
    await waitFor(() => expect(screen.getByText('Saved')).toBeDefined());
  });

  it('shows error toast when PATCH fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'db error' }) });
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByText(/Save failed/i)).toBeDefined());
  });

  it('renders gracefully with null catalogDivergence', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={{ ...baseProfile, catalogDivergence: null }} />);
    expect(screen.getByText('Catalog divergence')).toBeDefined();
    expect(screen.getByText('No divergence data')).toBeDefined();
  });
});
