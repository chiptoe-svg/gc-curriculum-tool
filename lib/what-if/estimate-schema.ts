import { z } from 'zod';
import type { WhatIfEstimate } from './types';

// The AI's estimate of how a proposed change moves a course's ratings. It never
// supplies "before" values: code reads those from the approved profile.

const depth = z.number().int().min(0).max(5).nullable();
const kudSchema = z.object({ k: depth, u: depth, d: depth });
const confidenceSchema = z.enum(['low', 'medium', 'high']);

export const whatIfEstimateSchema: z.ZodType<WhatIfEstimate> = z.object({
  changeItems: z.array(z.object({
    kind: z.enum(['added', 'removed', 'changed']),
    description: z.string().min(1),
  })),
  movedRatings: z.array(z.object({
    statement: z.string().min(1),
    after: kudSchema,
    confidence: confidenceSchema,
    reason: z.string().min(1),
  })),
  newCompetencies: z.array(z.object({
    statement: z.string().min(1),
    type: z.enum(['technical', 'foundational']),
    predicted: kudSchema,
    subCompetencyId: z.string().nullable(),
    confidence: confidenceSchema,
    reason: z.string().min(1),
  })),
  incomingChanges: z.array(z.object({
    kind: z.enum(['new', 'raised', 'dropped']),
    statement: z.string().min(1),
    expected: kudSchema.nullable(),
    subCompetencyId: z.string().nullable(),
  })),
});

// Strict OpenAI JSON schema: every property in `required`, additionalProperties
// false, optional values as nullable unions, recursively including array items.
const depthJson = { type: ['integer', 'null'], minimum: 0, maximum: 5 } as const;
const kudJson = {
  type: 'object',
  additionalProperties: false,
  required: ['k', 'u', 'd'],
  properties: { k: depthJson, u: depthJson, d: depthJson },
} as const;
const confidenceJson = { type: 'string', enum: ['low', 'medium', 'high'] } as const;

export const WHAT_IF_ESTIMATE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['changeItems', 'movedRatings', 'newCompetencies', 'incomingChanges'],
  properties: {
    changeItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'description'],
        properties: {
          kind: { type: 'string', enum: ['added', 'removed', 'changed'] },
          description: { type: 'string', minLength: 1 },
        },
      },
    },
    movedRatings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'after', 'confidence', 'reason'],
        properties: {
          statement: { type: 'string', minLength: 1 },
          after: kudJson,
          confidence: confidenceJson,
          reason: { type: 'string', minLength: 1 },
        },
      },
    },
    newCompetencies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'type', 'predicted', 'subCompetencyId', 'confidence', 'reason'],
        properties: {
          statement: { type: 'string', minLength: 1 },
          type: { type: 'string', enum: ['technical', 'foundational'] },
          predicted: kudJson,
          subCompetencyId: { type: ['string', 'null'] },
          confidence: confidenceJson,
          reason: { type: 'string', minLength: 1 },
        },
      },
    },
    incomingChanges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'statement', 'expected', 'subCompetencyId'],
        properties: {
          kind: { type: 'string', enum: ['new', 'raised', 'dropped'] },
          statement: { type: 'string', minLength: 1 },
          // Nullable object. Not a type-array because the node is an object schema.
          expected: { anyOf: [kudJson, { type: 'null' }] },
          subCompetencyId: { type: ['string', 'null'] },
        },
      },
    },
  },
};
