'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';

export interface IndexRow {
  id: string;
  name: string;
  status: 'active' | 'unlocked';
  courses: string[];
  stops: number;
  reinforcement: number;
  endCourse: string;
  endAct: 1 | 2 | 3;
  /** Name of the string this one merges into, when it does. */
  mergesInto: string | null;
}

type Sort = 'name' | 'course' | 'act';

export function StringsIndex({ rows, query = '' }: { rows: IndexRow[]; query?: string }) {
  const [sort, setSort] = useState<Sort>('name');
  const [showUnlocked, setShowUnlocked] = useState(false);
  const [act, setAct] = useState('');
  const [course, setCourse] = useState('');

  const allCourses = useMemo(() => [...new Set(rows.flatMap((r) => r.courses))].sort(), [rows]);
  const shown = useMemo(() => {
    const kept = rows.filter((r) => (showUnlocked || r.status === 'active') && (!act || String(r.endAct) === act) && (!course || r.courses.includes(course)));
    const by: Record<Sort, (a: IndexRow, b: IndexRow) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      course: (a, b) => a.endCourse.localeCompare(b.endCourse) || a.name.localeCompare(b.name),
      act: (a, b) => a.endAct - b.endAct || a.name.localeCompare(b.name),
    };
    return [...kept].sort(by[sort]);
  }, [rows, sort, showUnlocked, act, course]);

  return (
    <div className="st-index">
      <div className="st-controls">
        <label>Sort by{' '}
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="name">Name</option>
            <option value="course">End course</option>
            <option value="act">End Act</option>
          </select>
        </label>
        <label>End Act{' '}
          <select value={act} onChange={(e) => setAct(e.target.value)}>
            <option value="">Any</option>
            <option value="1">Act 1</option><option value="2">Act 2</option><option value="3">Act 3</option>
          </select>
        </label>
        <label>Course{' '}
          <select value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">Any</option>
            {allCourses.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={showUnlocked} onChange={(e) => setShowUnlocked(e.target.checked)} /> Show unlocked</label>
      </div>
      {shown.length === 0 ? <p className="cb-empty">No strings match.</p> : (
        <table className="st-table">
          <thead><tr><th>Name</th><th>Courses</th><th>Stops</th><th>Reinforced</th><th>Ends at</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/strings/${r.id}${query}`}>{r.name}</Link>{r.status === 'unlocked' ? ' (unlocked)' : ''}</td>
                <td className="cb-mono">{r.courses.join(', ')}</td>
                <td>{r.stops}</td>
                <td>{r.reinforcement}</td>
                <td>{r.mergesInto ? `Merges into ${r.mergesInto} at ${r.endCourse}` : `${r.endCourse} (Act ${r.endAct})`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
