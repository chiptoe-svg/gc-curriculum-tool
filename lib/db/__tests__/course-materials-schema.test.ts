import { describe, it, expect } from 'vitest';
import { courseMaterials, courseProfiles, courseProfileRuns } from '@/lib/db/schema';

describe('course_materials schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(courseMaterials);
    for (const c of [
      'id', 'courseCode', 'fileName', 'blobUrl', 'mimeType', 'sizeBytes',
      'pageCount', 'extractionMethod', 'extractionStatus', 'extractedText',
      'analysisFinding', 'analysisModel', 'analysisCostUsdCents',
      'uploadedAt', 'ipHash',
    ]) {
      expect(cols).toContain(c);
    }
  });
});

describe('course_profiles schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(courseProfiles);
    for (const c of [
      'courseCode', 'summary', 'learningObjectives', 'skills',
      'competencies', 'catalogDivergence', 'sourceRunId', 'manuallyEdited', 'updatedAt',
    ]) {
      expect(cols).toContain(c);
    }
  });
});

describe('course_profile_runs schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(courseProfileRuns);
    for (const c of [
      'id', 'courseCode', 'result', 'materialCount', 'model', 'costUsdCents', 'createdAt',
    ]) {
      expect(cols).toContain(c);
    }
  });
});
