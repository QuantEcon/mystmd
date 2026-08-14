import { describe, expect, test } from 'vitest';
import MarkdownIt from 'markdown-it';
import { headingAttributesPlugin, parseHeadingAttributes } from './headingAttributes';

describe('parseHeadingAttributes', () => {
  test('classes, id, and unnumbered', () => {
    expect(parseHeadingAttributes('#sec .fancy .unnumbered')).toEqual({
      enumerated: false,
      label: 'sec',
      classes: ['fancy'],
    });
  });
  test('pandoc dash shorthand', () => {
    expect(parseHeadingAttributes('-')).toEqual({ enumerated: false });
  });
  test('enumerated key', () => {
    expect(parseHeadingAttributes('enumerated=false')).toEqual({ enumerated: false });
    expect(parseHeadingAttributes('enumerated="true"')).toEqual({ enumerated: true });
  });
  test('rejects unknown vocabulary', () => {
    expect(parseHeadingAttributes('')).toBeUndefined();
    expect(parseHeadingAttributes('word')).toBeUndefined();
    expect(parseHeadingAttributes('foo=bar')).toBeUndefined();
    expect(parseHeadingAttributes('.ok stray')).toBeUndefined();
    expect(parseHeadingAttributes('#one #two')).toBeUndefined();
    expect(parseHeadingAttributes('#1digit')).toBeUndefined();
  });
});

describe('headingAttributesPlugin', () => {
  const md = MarkdownIt().use(headingAttributesPlugin);
  test('attaches meta and strips the block from heading text', () => {
    const tokens = md.parse('## Title {#sec .fancy .unnumbered}', {});
    const open = tokens.find((t) => t.type === 'heading_open');
    const inline = tokens.find((t) => t.type === 'inline');
    expect(open?.meta).toEqual({ enumerated: false, label: 'sec', class: 'fancy' });
    expect(inline?.content).toBe('Title');
  });
  test('leaves non-attribute braces as text', () => {
    const tokens = md.parse('## The set {1, 2, 3}', {});
    const open = tokens.find((t) => t.type === 'heading_open');
    const inline = tokens.find((t) => t.type === 'inline');
    expect(open?.meta).toBeNull();
    expect(inline?.content).toBe('The set {1, 2, 3}');
  });
  test('non-heading content is untouched', () => {
    const tokens = md.parse('A paragraph {.unnumbered}', {});
    const inline = tokens.find((t) => t.type === 'inline');
    expect(inline?.content).toBe('A paragraph {.unnumbered}');
  });
});
