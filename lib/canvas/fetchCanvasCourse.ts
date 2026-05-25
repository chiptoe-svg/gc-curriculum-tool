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

export interface CanvasPage {
  /** Canvas's url-slug for the page; stable per course. */
  url: string;
  title: string;
  bodyHtml: string;
  published: boolean;
}

export interface CanvasDiscussion {
  id: string;
  title: string;
  messageHtml: string;
  /** True when this discussion is also a graded assignment. */
  isAssignment: boolean;
  published: boolean;
}

export interface CanvasQuizQuestion {
  id: string;
  name: string;
  textHtml: string;
  questionType: string;
  pointsPossible: number | null;
  answers: Array<{ text: string; correct: boolean }>;
}

export interface CanvasQuiz {
  id: string;
  title: string;
  descriptionHtml: string;
  pointsPossible: number | null;
  questionCount: number | null;
  questions: CanvasQuizQuestion[];
  /** 'classic' for the legacy Quizzes API, 'new' for the New Quizzes API. */
  source: 'classic' | 'new';
}

export interface CanvasFileRef {
  id: string;
  displayName: string;
  url: string;          // download URL
  mimeType: string;
  sizeBytes: number;
}

export interface CanvasCourseData {
  course: CanvasCourse;
  assignments: CanvasAssignment[];
  modules: CanvasModule[];
  pages: CanvasPage[];
  discussions: CanvasDiscussion[];
  quizzes: CanvasQuiz[];
}

async function canvasFetch(baseUrl: string, path: string, token: string): Promise<unknown> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Canvas API ${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

// Canvas Pages: paginated, must fetch each page's body separately. This cap
// prevents us from sitting forever on courses with hundreds of historical
// pages — in practice most active courses have ≤30.
const MAX_PAGES_PER_COURSE = 100;
const MAX_DISCUSSIONS_PER_COURSE = 100;
const MAX_QUIZZES_PER_COURSE = 50;
const MAX_QUESTIONS_PER_QUIZ = 100;

async function fetchCanvasDiscussions(canvasBaseUrl: string, courseId: string, token: string): Promise<CanvasDiscussion[]> {
  let raw: unknown;
  try {
    raw = await canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}/discussion_topics?per_page=${MAX_DISCUSSIONS_PER_COURSE}`, token);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
  return list.slice(0, MAX_DISCUSSIONS_PER_COURSE).map(d => ({
    id: String(d['id'] ?? ''),
    title: String(d['title'] ?? ''),
    messageHtml: String(d['message'] ?? ''),
    isAssignment: d['assignment_id'] !== null && d['assignment_id'] !== undefined,
    published: typeof d['published'] === 'boolean' ? (d['published'] as boolean) : true,
  }));
}

async function fetchClassicQuizQuestions(
  canvasBaseUrl: string,
  courseId: string,
  quizId: string,
  token: string,
): Promise<CanvasQuizQuestion[]> {
  let raw: unknown;
  try {
    raw = await canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}/quizzes/${quizId}/questions?per_page=${MAX_QUESTIONS_PER_QUIZ}`, token);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
  return list.slice(0, MAX_QUESTIONS_PER_QUIZ).map(q => {
    const answers = Array.isArray(q['answers']) ? (q['answers'] as Record<string, unknown>[]) : [];
    return {
      id: String(q['id'] ?? ''),
      name: String(q['question_name'] ?? ''),
      textHtml: String(q['question_text'] ?? ''),
      questionType: String(q['question_type'] ?? ''),
      pointsPossible: typeof q['points_possible'] === 'number' ? q['points_possible'] : null,
      answers: answers.map(a => ({
        text: String(a['text'] ?? ''),
        // Canvas marks correct answers with weight === 100 (multiple choice / multiple answer).
        // True/false uses 'correct' bool; short answer doesn't expose correctness.
        correct: typeof a['weight'] === 'number' ? (a['weight'] as number) >= 100 : !!a['correct'],
      })),
    };
  });
}

async function fetchCanvasQuizzes(canvasBaseUrl: string, courseId: string, token: string): Promise<CanvasQuiz[]> {
  let raw: unknown;
  try {
    raw = await canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}/quizzes?per_page=${MAX_QUIZZES_PER_COURSE}`, token);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
  const quizMeta = list.slice(0, MAX_QUIZZES_PER_COURSE).map(q => ({
    id: String(q['id'] ?? ''),
    title: String(q['title'] ?? ''),
    descriptionHtml: String(q['description'] ?? ''),
    pointsPossible: typeof q['points_possible'] === 'number' ? q['points_possible'] : null,
    questionCount: typeof q['question_count'] === 'number' ? q['question_count'] : null,
  }));
  // Fetch each quiz's questions in parallel.
  const withQuestions = await Promise.all(
    quizMeta.map(async meta => {
      if (!meta.id) return null;
      const questions = await fetchClassicQuizQuestions(canvasBaseUrl, courseId, meta.id, token);
      return {
        ...meta,
        questions,
        source: 'classic' as const,
      };
    }),
  );
  return withQuestions.flatMap(q => q ? [q] : []);
}

async function fetchCanvasPages(canvasBaseUrl: string, courseId: string, token: string): Promise<CanvasPage[]> {
  let listRaw: unknown;
  try {
    listRaw = await canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}/pages?per_page=${MAX_PAGES_PER_COURSE}`, token);
  } catch {
    // Courses with Pages disabled return 404; treat as empty rather than failing the whole import.
    return [];
  }
  const list = Array.isArray(listRaw) ? listRaw as Record<string, unknown>[] : [];
  if (list.length === 0) return [];

  // Each page-list entry omits the body. Fetch each page individually in
  // parallel. Skip pages whose url is missing.
  const details = await Promise.all(
    list.slice(0, MAX_PAGES_PER_COURSE).map(async (p) => {
      const url = typeof p['url'] === 'string' ? (p['url'] as string) : null;
      if (!url) return null;
      try {
        const pageRaw = await canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}/pages/${encodeURIComponent(url)}`, token);
        const pd = pageRaw as Record<string, unknown>;
        return {
          url,
          title: String(pd['title'] ?? p['title'] ?? ''),
          bodyHtml: String(pd['body'] ?? ''),
          published: typeof pd['published'] === 'boolean' ? (pd['published'] as boolean) : true,
        } as CanvasPage;
      } catch {
        return null;
      }
    }),
  );
  return details.flatMap(p => p ? [p] : []);
}

export async function fetchCanvasCourse(canvasBaseUrl: string, courseId: string, token: string): Promise<CanvasCourseData> {
  const [courseRaw, assignmentsRaw, modulesRaw, pages, discussions, quizzes] = await Promise.all([
    canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}?include[]=syllabus_body`, token),
    // include[]=rubric returns the inline rubric criteria + ratings;
    // include[]=rubric_settings adds the rubric's title and total points.
    canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}/assignments?per_page=50&include[]=rubric&include[]=rubric_settings`, token),
    canvasFetch(canvasBaseUrl, `/api/v1/courses/${courseId}/modules?include[]=items&per_page=50`, token),
    fetchCanvasPages(canvasBaseUrl, courseId, token),
    fetchCanvasDiscussions(canvasBaseUrl, courseId, token),
    fetchCanvasQuizzes(canvasBaseUrl, courseId, token),
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

  return { course, assignments, modules, pages, discussions, quizzes };
}

/**
 * Fetch metadata for a specific Canvas file by ID. Used by the
 * file-attachment scanner to verify a referenced file exists and to
 * obtain its download URL + content-type before deciding whether to
 * extract its text.
 */
export async function fetchCanvasFileMeta(
  canvasBaseUrl: string,
  fileId: string,
  token: string,
): Promise<CanvasFileRef | null> {
  let raw: unknown;
  try {
    raw = await canvasFetch(canvasBaseUrl, `/api/v1/files/${fileId}`, token);
  } catch {
    return null;
  }
  const f = raw as Record<string, unknown>;
  if (!f['id']) return null;
  return {
    id: String(f['id']),
    displayName: String(f['display_name'] ?? f['filename'] ?? ''),
    url: String(f['url'] ?? ''),
    mimeType: String(f['content-type'] ?? f['contentType'] ?? ''),
    sizeBytes: typeof f['size'] === 'number' ? (f['size'] as number) : 0,
  };
}
