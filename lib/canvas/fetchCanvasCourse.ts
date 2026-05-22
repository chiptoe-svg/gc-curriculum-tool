export interface CanvasCourse {
  id: string;
  name: string;
  syllabusHtml: string;
}

export interface CanvasAssignment {
  id: string;
  name: string;
  descriptionHtml: string;
  pointsPossible: number | null;
}

export interface CanvasModule {
  id: string;
  name: string;
  items: Array<{ title: string; type: string }>;
}

export interface CanvasCourseData {
  course: CanvasCourse;
  assignments: CanvasAssignment[];
  modules: CanvasModule[];
}

async function canvasFetch(baseUrl: string, path: string, token: string): Promise<unknown> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Canvas API ${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchCanvasCourse(canvasBaseUrl: string, courseId: string, token: string): Promise<CanvasCourseData> {
  const [courseRaw, assignmentsRaw, modulesRaw] = await Promise.all([
    canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}?include[]=syllabus_body`, token),
    canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}/assignments?per_page=50`, token),
    canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}/modules?include[]=items&per_page=50`, token),
  ]);

  const c = courseRaw as Record<string, unknown>;
  const course: CanvasCourse = {
    id: String(c['id'] ?? courseId),
    name: String(c['name'] ?? ''),
    syllabusHtml: String(c['syllabus_body'] ?? ''),
  };

  const assignments: CanvasAssignment[] = ((Array.isArray(assignmentsRaw) ? assignmentsRaw : []) as Record<string, unknown>[]).map((a) => ({
    id: String(a['id'] ?? ''),
    name: String(a['name'] ?? ''),
    descriptionHtml: String(a['description'] ?? ''),
    pointsPossible: typeof a['points_possible'] === 'number' ? a['points_possible'] : null,
  }));

  const modules: CanvasModule[] = ((Array.isArray(modulesRaw) ? modulesRaw : []) as Record<string, unknown>[]).map((m) => ({
    id: String(m['id'] ?? ''),
    name: String(m['name'] ?? ''),
    items: ((Array.isArray(m['items']) ? m['items'] : []) as Record<string, unknown>[]).map((i) => ({
      title: String(i['title'] ?? ''),
      type: String(i['type'] ?? ''),
    })),
  }));

  return { course, assignments, modules };
}
