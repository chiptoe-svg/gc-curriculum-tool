import { describe, it, expect } from 'vitest';
import { detectFerpaRisk } from '@/lib/capture/ferpa-detect';

describe('detectFerpaRisk', () => {
  it('returns low for benign content', () => {
    expect(detectFerpaRisk('A chapter on color theory and ΔE.').level).toBe('low');
  });

  it('flags "Submitted by <Name>" as medium risk', () => {
    const r = detectFerpaRisk('Submitted by Jane Doe on October 14, 2025\nAssignment 4: ...');
    expect(r.level).toBe('medium');
    expect(r.matches.length).toBeGreaterThan(0);
  });

  it('flags "Posted by <Name> on <Date>" as medium risk', () => {
    const r = detectFerpaRisk('Posted by Alex Kim on 2026-03-12: I think the prereq is ...');
    expect(r.level).toBe('medium');
  });

  it('flags Clemson CUID patterns (C12345678) as high risk', () => {
    const r = detectFerpaRisk('Student C12345678 submitted on time.');
    expect(r.level).toBe('high');
  });

  it('flags gradebook tables (Name | Grade) as high risk', () => {
    const r = detectFerpaRisk('Name | Grade | Notes\nAlex K | 92 | good\nJamie L | 78 | ok');
    expect(r.level).toBe('high');
  });

  it('escalates to high when multiple medium signals appear', () => {
    const text = 'Submitted by Jane Doe\nPosted by Alex Kim on 2026-03-12';
    const r = detectFerpaRisk(text);
    expect(r.level).toBe('high');
  });

  it('handles empty input', () => {
    expect(detectFerpaRisk('').level).toBe('low');
    expect(detectFerpaRisk(null).level).toBe('low');
    expect(detectFerpaRisk(undefined).level).toBe('low');
  });

  it('flags non-literal gradebook headers (Student | Score) as high', () => {
    expect(detectFerpaRisk('Student | Score\nAlex K | 92\nJamie L | 78').level).toBe('high');
  });

  it('flags split-name gradebook headers (First Name | Last Name | Final) as high', () => {
    expect(detectFerpaRisk('First Name | Last Name | Final\nAlex | Kim | 92').level).toBe('high');
  });

  it('flags two or more distinct emails (roster) as high', () => {
    const r = detectFerpaRisk('alex.kim@clemson.edu\njamie.lee@clemson.edu');
    expect(r.level).toBe('high');
  });

  it('does NOT escalate on a single (likely instructor) email', () => {
    expect(detectFerpaRisk('Contact: profsmith@clemson.edu for office hours.').level).toBe('low');
  });

  it('flags a roster-shaped table of person names as at least medium', () => {
    const r = detectFerpaRisk(
      'Roster | Section\nJane Smith | 01\nAlex Kim | 01\nJamie Lee | 02\nPat Cho | 02',
    );
    expect(r.level === 'medium' || r.level === 'high').toBe(true);
  });

  it('leaves a benign prose syllabus low', () => {
    expect(detectFerpaRisk('Week 1: Color Theory. Week 2: Halftone screening and dot gain.').level).toBe('low');
  });
});
