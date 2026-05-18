export interface ParsedCourse {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
  prerequisites: string;
  syllabusUrl: string | null;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

const SECTION_HEADERS: Record<string, keyof Pick<ParsedCourse, 'learningObjectives' | 'majorProjects' | 'skillsRequired'>> = {
  'learning objectives': 'learningObjectives',
  'major projects': 'majorProjects',
  'skills/competencies required': 'skillsRequired',
  'skills required': 'skillsRequired',
};

const SCALAR_FIELDS: Record<string, 'title' | 'level' | 'track' | 'description' | 'prerequisites' | 'syllabusUrl'> = {
  'title': 'title',
  'level': 'level',
  'track': 'track',
  'description': 'description',
  'prerequisites': 'prerequisites',
  'syllabus url': 'syllabusUrl',
};

// Parses one CSV line into [colA, colB]. Handles quoted values with embedded quotes ("").
function parseCsvLine(line: string): [string, string] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  cells.push(cur);
  return [cells[0] ?? '', cells[1] ?? ''];
}

function splitCollapsedCodeTitle(value: string): { code: string; title: string } {
  // "GC 4900ap Special Topics: Analog Photography" → code: "GC 4900ap", title: rest
  const m = value.match(/^(GC\s+\d{4}[a-z]{0,2})\s+(.*)$/i);
  if (!m) return { code: value.trim(), title: '' };
  return { code: m[1]!.trim(), title: m[2]!.trim() };
}

export function parseCourseTab(csv: string): ParsedCourse {
  const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
  const out: ParsedCourse = {
    code: '', title: '', level: 0, track: '',
    description: '', prerequisites: '', syllabusUrl: null,
    learningObjectives: [], majorProjects: [], skillsRequired: [],
  };

  let currentSection: keyof Pick<ParsedCourse, 'learningObjectives' | 'majorProjects' | 'skillsRequired'> | null = null;

  for (const line of lines) {
    const [rawLabel, rawValue] = parseCsvLine(line);
    const label = rawLabel.trim();
    const value = rawValue.trim();
    const labelLower = label.toLowerCase();

    // Section continuation: empty label, value present.
    if (label === '' && value !== '' && currentSection) {
      out[currentSection].push(value);
      continue;
    }

    // Section header: known section name with empty value.
    if (labelLower in SECTION_HEADERS && value === '') {
      currentSection = SECTION_HEADERS[labelLower]!;
      continue;
    }

    // Scalar fields exit any active section.
    currentSection = null;

    if (labelLower === 'course code') {
      out.code = value;
      continue;
    }
    if (labelLower === 'course code title') {
      // Apps-Script-collapsed first row: split the combined value.
      const split = splitCollapsedCodeTitle(value);
      out.code = split.code;
      if (!out.title) out.title = split.title;
      continue;
    }
    if (labelLower in SCALAR_FIELDS) {
      const field = SCALAR_FIELDS[labelLower]!;
      if (field === 'level') {
        const n = parseInt(value, 10);
        if (!Number.isNaN(n)) out.level = n;
      } else if (field === 'syllabusUrl') {
        out.syllabusUrl = value || null;
      } else {
        out[field] = value;
      }
      continue;
    }
    // Unknown labels: ignore (forward-compatible with new sheet fields).
  }

  if (!out.code) throw new Error('parseCourseTab: missing course code');
  if (!out.title) throw new Error('parseCourseTab: missing course title');
  return out;
}
