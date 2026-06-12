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
  it('renders three fields: Course code, Title, and Catalog URL', () => {
    render(<NewCourseForm slug="test-slug" />);
    expect(screen.getByLabelText(/course code/i)).toBeTruthy();
    expect(screen.getByLabelText(/title/i)).toBeTruthy();
    expect(screen.getByLabelText(/catalog url/i)).toBeTruthy();
  });

  it('on successful submit POSTs the right body and navigates to /capture/<code>', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<NewCourseForm slug="s1" />);

    fireEvent.change(screen.getByLabelText(/course code/i), {
      target: { value: 'GC 1234' },
    });
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Test Course' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /add course/i }).closest('form')!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/admin/courses/roster');
    expect(String(url)).toContain('slug=s1');

    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
    expect(body.mode).toBe('one');
    expect(body.code).toBe('GC 1234');
    expect(body.title).toBe('Test Course');
    expect(body.catalogUrl).toBeUndefined();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/capture/GC%201234?slug=s1');
    });
  });

  it('includes catalogUrl in the POST body when provided', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<NewCourseForm slug="s1" />);

    fireEvent.change(screen.getByLabelText(/course code/i), { target: { value: 'GC 5678' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Advanced Course' } });
    fireEvent.change(screen.getByLabelText(/catalog url/i), {
      target: { value: 'https://catalog.clemson.edu/gc5678' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /add course/i }).closest('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse(
      ((fetchMock.mock.calls[0]![1] as RequestInit).body as string),
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

    fireEvent.change(screen.getByLabelText(/course code/i), { target: { value: 'GC 9999' } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Duplicate' } });
    fireEvent.submit(screen.getByRole('button', { name: /add course/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/course already exists/i)).toBeTruthy();
    });

    // Should not have navigated
    expect(pushMock).not.toHaveBeenCalled();
  });
});
