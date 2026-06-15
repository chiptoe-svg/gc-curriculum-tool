import { XMLParser } from 'fast-xml-parser';
import type { CanvasQuiz, CanvasQuizQuestion } from '@/lib/canvas/fetchCanvasCourse';

/** Coerce a value to a non-empty array, or return []. */
function toArray<T>(x: T | T[] | null | undefined): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

/** Extract text from a mattext node, which fast-xml-parser may return as a
 *  plain string or as an object with '#text' when it has attributes. */
function mattextContent(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  const obj = node as Record<string, unknown>;
  if ('#text' in obj) return String(obj['#text'] ?? '');
  return '';
}

export function parseQtiAssessment(xml: string, id: string): CanvasQuiz {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    // Keep text nodes even when there are sibling attributes
    textNodeName: '#text',
  });

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return {
      id,
      title: '',
      descriptionHtml: '',
      pointsPossible: null,
      questionCount: 0,
      questions: [],
      source: 'classic',
      published: true,
    };
  }

  const qti = (doc['questestinterop'] ?? {}) as Record<string, unknown>;
  const assessment = (qti['assessment'] ?? {}) as Record<string, unknown>;
  const title = String((assessment['@_title'] as string | undefined) ?? '');

  // Items live in section; handle one level of nesting
  const section = (assessment['section'] ?? {}) as Record<string, unknown>;
  const rawItems = section['item'];
  const items = toArray(rawItems);

  const questions: CanvasQuizQuestion[] = items.map((rawItem, idx) => {
    const item = rawItem as Record<string, unknown>;
    const itemTitle = String((item['@_title'] as string | undefined) ?? '');
    const itemIdent = String((item['@_ident'] as string | undefined) ?? String(idx));

    // --- text ---
    const presentation = (item['presentation'] ?? {}) as Record<string, unknown>;
    const material = (presentation['material'] ?? {}) as Record<string, unknown>;
    const textHtml = mattextContent(material['mattext']);

    // --- answers ---
    const responseLid = presentation['response_lid'] as Record<string, unknown> | undefined;
    let answers: Array<{ text: string; correct: boolean }> = [];

    if (responseLid) {
      const renderChoice = (responseLid['render_choice'] ?? {}) as Record<string, unknown>;
      const labels = toArray(renderChoice['response_label']);

      // Collect correct idents from resprocessing
      const resprocessing = (item['resprocessing'] ?? {}) as Record<string, unknown>;
      const respconditions = toArray(resprocessing['respcondition']);
      const correctIdents = new Set<string>();
      for (const rc of respconditions) {
        const cond = (rc as Record<string, unknown>)['conditionvar'] as Record<string, unknown> | undefined;
        if (!cond) continue;
        const ve = cond['varequal'];
        // varequal may be a string, a number, or {#text, @_respident}
        const veArr = toArray(ve);
        for (const v of veArr) {
          const text = mattextContent(v) || (typeof v === 'number' ? String(v) : '');
          if (text) correctIdents.add(text);
        }
      }

      answers = labels.map((label) => {
        const l = label as Record<string, unknown>;
        const ident = String((l['@_ident'] as string | undefined) ?? '');
        const lMat = (l['material'] ?? {}) as Record<string, unknown>;
        const text = mattextContent(lMat['mattext']);
        return { text, correct: correctIdents.has(ident) };
      });
    }

    const questionType = responseLid ? 'multiple_choice_question' : 'essay_question';

    return {
      id: itemIdent,
      name: itemTitle,
      textHtml,
      questionType,
      pointsPossible: null,
      answers,
    };
  });

  return {
    id,
    title,
    descriptionHtml: '',
    pointsPossible: null,
    questionCount: questions.length,
    questions,
    source: 'classic',
    published: true,
  };
}
