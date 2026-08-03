import { describe, it, expect } from 'vitest';
import { sanitizeExtractedText } from '@/lib/capture/sanitize-extracted-text';

describe('sanitizeExtractedText', () => {
  it('strips a Flavour-A reasoning preamble but keeps surrounding markdown', () => {
    const input = [
      '--- page 3 ---',
      'The user wants a description of the provided image. 1. Identify the main subject: a bar chart.',
      '',
      '--- page 4 ---',
      '# Typography basics',
      'Kerning is the space between individual letters.',
    ].join('\n');
    const out = sanitizeExtractedText(input);
    expect(out).toContain('# Typography basics');
    expect(out).toContain('Kerning is the space between individual letters.');
    expect(out).not.toMatch(/user wants a description/i);
    expect(out).not.toMatch(/identify the main subject/i);
  });

  it('drops a Flavour-B failure-narration sentence, keeps real text', () => {
    const input =
      'Vectors scale without loss of quality. The provided image is completely blank and contains no visible content to transcribe. Bezier curves define paths.';
    const out = sanitizeExtractedText(input);
    expect(out).toContain('Vectors scale without loss of quality.');
    expect(out).toContain('Bezier curves define paths.');
    expect(out).not.toMatch(/completely blank/i);
    expect(out).not.toMatch(/no visible content to transcribe/i);
  });

  it('drops degenerate character-cycle repetition runs', () => {
    const input = 'Real content here. bbbmtttllwwcccccpptsjjyyyyyyymmmbbbmtttllwwcccccpptsjj more real content.';
    const out = sanitizeExtractedText(input);
    expect(out).toContain('Real content here.');
    expect(out).toContain('more real content.');
    expect(out).not.toMatch(/bbbmtttllww/);
  });

  it('returns empty string when the whole field is contamination', () => {
    const input =
      'The provided image is a graphical representation and does not contain any textual content that can be transcribed.';
    expect(sanitizeExtractedText(input).trim()).toBe('');
  });

  it('returns clean real text byte-identical', () => {
    const input = '# Syllabus\nWeek 1: Introduction to Graphic Communications.\nWeek 2: Color theory.';
    expect(sanitizeExtractedText(input)).toBe(input);
  });
});
