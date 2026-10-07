/**
 * Owner, 2026-10-07: a locally served step-by-step how-to with screenshots at
 * /curriculum/howto, linked from the capture header.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync, existsSync } from 'node:fs';

vi.mock('@/app/FeedbackLink', () => ({ FeedbackLink: () => null }));

import HowToPage from '@/app/curriculum/howto/page';

function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('/curriculum/howto', () => {
  it('shows 12 numbered steps, each with a screenshot that exists at the stated size', () => {
    render(<HowToPage />);
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(12);
    for (const img of imgs) {
      const src = img.getAttribute('src')!;
      const file = `public${src}`;
      expect(existsSync(file), file).toBe(true);
      const [w, h] = pngSize(file);
      expect(Number(img.getAttribute('width')) * 2).toBe(w);
      expect(Number(img.getAttribute('height')) * 2).toBe(h);
      expect(img.getAttribute('alt')).toBeTruthy();
    }
    expect(screen.getByRole('heading', { name: /answer the interviewer/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /if something goes wrong/i })).toBeTruthy();
  });

  it('the capture header shows the how-to in place of the guide; the home page links to it', () => {
    const capture = readFileSync('app/capture/[code]/page.tsx', 'utf8');
    expect(capture).toMatch(/href="\/curriculum\/howto"/);
    expect(capture).not.toMatch(/Guide ↗/);
    expect(readFileSync('app/page.tsx', 'utf8')).toMatch(/path="\/curriculum\/howto"/);
  });

  it('links the detailed guide', () => {
    render(<HowToPage />);
    const links = screen.getAllByRole('link', { name: /detailed guide/i });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.getAttribute('href')).toMatch(/using-coursecapture-and-explore\.html/);
  });
});
