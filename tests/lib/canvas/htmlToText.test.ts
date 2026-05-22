import { describe, it, expect } from 'vitest';
import { htmlToText } from '@/lib/canvas/htmlToText';

describe('htmlToText', () => {
  it('strips basic tags', () => {
    expect(htmlToText('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });

  it('converts block tags to newlines', () => {
    const result = htmlToText('<p>First</p><p>Second</p>');
    expect(result).toContain('First');
    expect(result).toContain('Second');
    expect(result.indexOf('First')).toBeLessThan(result.indexOf('Second'));
  });

  it('decodes HTML entities', () => {
    const result = htmlToText('Fish &amp; Chips &lt;tasty&gt;');
    expect(result).toContain('Fish & Chips');
    expect(result).toContain('<tasty>');
  });

  it('removes script and style blocks entirely', () => {
    const result = htmlToText('<style>body{color:red}</style><p>Content</p><script>alert(1)</script>');
    expect(result).toBe('Content');
    expect(result).not.toContain('color');
    expect(result).not.toContain('alert');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(htmlToText('plain text')).toBe('plain text');
  });
});
