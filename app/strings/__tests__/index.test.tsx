import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { StringsIndex, type IndexRow } from '../StringsIndex';
import { clusterStringHref } from '@/lib/builder/strings/href';

const row = (id: string, name: string, endAct: 1 | 2 | 3, status: 'active' | 'unlocked' = 'active', courses = ['GC 1010']): IndexRow => ({
  id, name, status, courses, stops: courses.length, reinforcement: 0, endCourse: courses[courses.length - 1]!, endAct, mergesInto: null,
});
afterEach(cleanup);
const names = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent);

describe('StringsIndex', () => {
  it('sorts by end Act, Act 1 before Act 3', () => {
    render(<StringsIndex rows={[row('a', 'Late', 3), row('b', 'Early', 1), row('c', 'Mid', 2)]} />);
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'act' } });
    expect(names()).toEqual(['Early', 'Mid', 'Late']);
  });
  it('hides unlocked strings until the toggle', () => {
    render(<StringsIndex rows={[row('a', 'Live', 1), row('b', 'Open', 1, 'unlocked')]} />);
    expect(names()).toEqual(['Live']);
    fireEvent.click(screen.getByLabelText('Show unlocked'));
    expect(names()).toContain('Open (unlocked)');
  });
  it('filters by course', () => {
    render(<StringsIndex rows={[row('a', 'One', 1, 'active', ['GC 1010']), row('b', 'Two', 1, 'active', ['GC 2400'])]} />);
    fireEvent.change(screen.getByLabelText('Course'), { target: { value: 'GC 2400' } });
    expect(names()).toEqual(['Two']);
  });
});

describe('clusterStringHref', () => {
  it('encodes and de-duplicates in order', () => {
    expect(clusterStringHref(['GC 2400', 'GC 1010', 'GC 2400'])).toBe('/build/clusters/new?courses=GC%202400,GC%201010');
  });
  it('keeps the access query after the courses', () => {
    expect(clusterStringHref(['GC 1010', 'GC 2070'], '?slug=ab-12')).toBe('/build/clusters/new?courses=GC%201010,GC%202070&slug=ab-12');
  });
});
