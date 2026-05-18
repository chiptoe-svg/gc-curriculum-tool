export function gvizUrl(sheetId: string, tabName: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
}

const COURSE_CODE_RE = /^GC\s+\d{4}[a-z]{0,2}$/i;

export async function fetchIndexCourseCodes(sheetId: string, indexTabName = 'Index'): Promise<string[]> {
  const url = gvizUrl(sheetId, indexTabName);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchIndexCourseCodes: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const codes: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const first = line.match(/^"([^"]*)"/)?.[1]?.trim();
    if (first && COURSE_CODE_RE.test(first)) codes.push(first);
  }
  return codes;
}

export async function fetchCourseTabCsv(sheetId: string, courseCode: string): Promise<string> {
  const url = gvizUrl(sheetId, courseCode);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchCourseTabCsv ${courseCode}: ${res.status} ${res.statusText}`);
  return res.text();
}
