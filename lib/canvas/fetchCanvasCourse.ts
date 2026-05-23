export interface CanvasCourse {
  id: string;
  name: string;
  syllabusHtml: string;
}

export interface CanvasRubricRating {
  description: string;
  longDescription: string;
  points: number | null;
}

export interface CanvasRubricCriterion {
  description: string;
  longDescription: string;
  points: number | null;
  ratings: CanvasRubricRating[];
}

export interface CanvasAssignment {
  id: string;
  name: string;
  descriptionHtml: string;
  pointsPossible: number | null;
  /** Rubric criteria from Canvas, when the assignment has a rubric attached. */
  rubric: CanvasRubricCriterion[];
  /** Title of the rubric (separate from the assignment name) when set. */
  rubricTitle: string | null;
}

export interface CanvasModuleItem {
  title: string;
  type: string;
  /** For ExternalUrl items, the linked URL. Null otherwise. */
  externalUrl: string | null;
  /** Canvas's own internal URL for the item (page, file, etc.). Useful for File/Page items. */
  htmlUrl: string | null;
}

export interface CanvasModule {
  id: string;
  name: string;
  items: CanvasModuleItem[];
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
    // include[]=rubric returns the inline rubric criteria + ratings;
    // include[]=rubric_settings adds the rubric's title and total points.
    canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}/assignments?per_page=50&include[]=rubric&include[]=rubric_settings`, token),
    canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}/modules?include[]=items&per_page=50`, token),
  ]);

  const c = courseRaw as Record<string, unknown>;
  const course: CanvasCourse = {
    id: String(c['id'] ?? courseId),
    name: String(c['name'] ?? ''),
    syllabusHtml: String(c['syllabus_body'] ?? ''),
  };

  const assignments: CanvasAssignment[] = ((Array.isArray(assignmentsRaw) ? assignmentsRaw : []) as Record<string, unknown>[]).map((a) => {
    const rubricRaw = Array.isArray(a['rubric']) ? (a['rubric'] as Record<string, unknown>[]) : [];
    const rubric: CanvasRubricCriterion[] = rubricRaw.map(c => ({
      description: String(c['description'] ?? ''),
      longDescription: String(c['long_description'] ?? ''),
      points: typeof c['points'] === 'number' ? c['points'] : null,
      ratings: ((Array.isArray(c['ratings']) ? c['ratings'] : []) as Record<string, unknown>[]).map(r => ({
        description: String(r['description'] ?? ''),
        longDescription: String(r['long_description'] ?? ''),
        points: typeof r['points'] === 'number' ? r['points'] : null,
      })),
    }));
    const rubricSettingsRaw = (a['rubric_settings'] ?? null) as Record<string, unknown> | null;
    const rubricTitle = rubricSettingsRaw && typeof rubricSettingsRaw['title'] === 'string'
      ? (rubricSettingsRaw['title'] as string)
      : null;
    return {
      id: String(a['id'] ?? ''),
      name: String(a['name'] ?? ''),
      descriptionHtml: String(a['description'] ?? ''),
      pointsPossible: typeof a['points_possible'] === 'number' ? a['points_possible'] : null,
      rubric,
      rubricTitle,
    };
  });

  const modules: CanvasModule[] = ((Array.isArray(modulesRaw) ? modulesRaw : []) as Record<string, unknown>[]).map((m) => ({
    id: String(m['id'] ?? ''),
    name: String(m['name'] ?? ''),
    items: ((Array.isArray(m['items']) ? m['items'] : []) as Record<string, unknown>[]).map((i) => ({
      title: String(i['title'] ?? ''),
      type: String(i['type'] ?? ''),
      externalUrl: typeof i['external_url'] === 'string' ? (i['external_url'] as string) : null,
      htmlUrl: typeof i['html_url'] === 'string' ? (i['html_url'] as string) : null,
    })),
  }));

  return { course, assignments, modules };
}
