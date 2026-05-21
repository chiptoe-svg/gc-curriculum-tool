import { z } from 'zod';

// ── Per-file finding (cached on course_materials.analysisFinding) ─────────────

const analysisFindingCompetencySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  evidenceQuotes: z.array(z.string()),
});

export const analysisFindingSchema = z.object({
  materialType: z.string().min(1),
  competencies: z.array(analysisFindingCompetencySchema),
  skills: z.array(z.string()),
  notes: z.string(),
});

export type AnalysisFinding = z.infer<typeof analysisFindingSchema>;

export const analysisFindingJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['materialType', 'competencies', 'skills', 'notes'],
  properties: {
    materialType: { type: 'string' },
    competencies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'evidenceQuotes'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          evidenceQuotes: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    skills: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
} as const;

// ── Synthesized course profile ─────────────────────────────────────────────────

const profileCompetencySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  level: z.string().min(1),
  evidence: z.array(
    z.object({
      fileName: z.string().min(1),
      quote: z.string().min(1),
    })
  ),
});

const catalogDivergenceSchema = z.object({
  reinforced: z.array(z.string()),
  additions: z.array(z.string()),
  gaps: z.array(z.string()),
});

export const courseProfileResultSchema = z.object({
  summary: z.string().min(1),
  learningObjectives: z.array(z.string()),
  skills: z.array(z.string()),
  competencies: z.array(profileCompetencySchema),
  catalogDivergence: catalogDivergenceSchema,
});

export type CourseProfileResult = z.infer<typeof courseProfileResultSchema>;

export const courseProfileResultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'learningObjectives', 'skills', 'competencies', 'catalogDivergence'],
  properties: {
    summary: { type: 'string' },
    learningObjectives: { type: 'array', items: { type: 'string' } },
    skills: { type: 'array', items: { type: 'string' } },
    competencies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'level', 'evidence'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          level: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['fileName', 'quote'],
              properties: {
                fileName: { type: 'string' },
                quote: { type: 'string' },
              },
            },
          },
        },
      },
    },
    catalogDivergence: {
      type: 'object',
      additionalProperties: false,
      required: ['reinforced', 'additions', 'gaps'],
      properties: {
        reinforced: { type: 'array', items: { type: 'string' } },
        additions: { type: 'array', items: { type: 'string' } },
        gaps: { type: 'array', items: { type: 'string' } },
      },
    },
  },
} as const;
