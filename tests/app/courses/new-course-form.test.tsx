import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewCourseForm } from '@/app/courses/new/NewCourseForm';

// Mock next/navigation
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  pushMock.mockReset();
});

describe('NewCourseForm', () => {
  it('renders prefix, course number, title, and catalog url fields', () => {
    render(<NewCourseForm slug="test-slug" />);
    expect(screen.getByLabelText(/prefix/i)).toBeTruthy();
    expect(screen.getByLabelText(/course number/i)).toBeTruthy();
    expect(screen.getByLabelText(/title/i)).toBeTruthy();
    expect(screen.getByLabelText(/catalog url/i)).toBeTruthy();
  });

  it('composes code from prefix + number and navigates to capture on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<NewCourseForm slug="s" />);
    fireEvent.change(screen.getByLabelText(/prefix/i), { target: { value: 'GC' } });
    fireEvent.change(screen.getByLabelText(/course number/i), { target: { value: '3460' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Junior Seminar' } });
    fireEvent.click(screen.getByRole('button', { name: /add course & start capture/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({ mode: 'one', code: 'GC 3460', title: 'Junior Seminar' });

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('/capture/GC%203460')));
  });

  it('includes a paired course when the disclosure is filled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<NewCourseForm slug="s" />);
    fireEvent.change(screen.getByLabelText(/prefix/i), { target: { value: 'GC' } });
    fireEvent.change(screen.getByLabelText(/course number/i), { target: { value: '3460' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Lecture' } });
    fireEvent.click(screen.getByRole('button', { name: /add a paired course/i }));
    fireEvent.change(screen.getByLabelText(/paired number/i), { target: { value: '3461' } });
    fireEvent.change(screen.getByLabelText(/paired role/i), { target: { value: 'lab' } });
    fireEvent.click(screen.getByRole('button', { name: /add course & start capture/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({ mode: 'one', code: 'GC 3460', pairedCode: 'GC 3461', pairedRole: 'lab' });
  });

  it('requires prefix, number, and title', () => {
    render(<NewCourseForm slug="s" />);
    fireEvent.click(screen.getByRole('button', { name: /add course & start capture/i }));
    expect(screen.getByText(/required/i)).toBeTruthy();
  });

  it('includes catalogUrl in the POST body when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<NewCourseForm slug="s1" />);
    fireEvent.change(screen.getByLabelText(/prefix/i), { target: { value: 'GC' } });
    fireEvent.change(screen.getByLabelText(/course number/i), { target: { value: '5678' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Advanced Course' } });
    fireEvent.change(screen.getByLabelText(/catalog url/i), {
      target: { value: 'https://catalog.clemson.edu/gc5678' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add course & start capture/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]![1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(body.catalogUrl).toBe('https://catalog.clemson.edu/gc5678');
  });

  it('shows inline error when the API returns an error response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'course already exists' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<NewCourseForm slug="s1" />);
    fireEvent.change(screen.getByLabelText(/prefix/i), { target: { value: 'GC' } });
    fireEvent.change(screen.getByLabelText(/course number/i), { target: { value: '9999' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: /add course & start capture/i }));

    await waitFor(() => {
      expect(screen.getByText(/course already exists/i)).toBeTruthy();
    });

    // Should not have navigated
    expect(pushMock).not.toHaveBeenCalled();
  });
});
