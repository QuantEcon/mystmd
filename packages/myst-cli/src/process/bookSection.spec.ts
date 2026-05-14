import { describe, expect, test } from 'vitest';
import type { PageFrontmatter } from 'myst-frontmatter';
import { injectBookSectionDefaults } from './mdast.js';

describe('injectBookSectionDefaults', () => {
  test('no-op when book mode is off', () => {
    const fm: PageFrontmatter = { numbering: {} };
    injectBookSectionDefaults(fm, 'chapters', false);
    expect(fm.numbering).toEqual({});
  });

  test('no-op when section is undefined', () => {
    const fm: PageFrontmatter = { numbering: { book: { enabled: true } } };
    injectBookSectionDefaults(fm, undefined, false);
    expect(fm.numbering).toEqual({ book: { enabled: true } });
  });

  test('chapters section seeds heading_1 with the Chapter label', () => {
    const fm: PageFrontmatter = { numbering: { book: { enabled: true } } };
    injectBookSectionDefaults(fm, 'chapters', false);
    expect(fm.numbering?.heading_1).toEqual({ enabled: true, label: 'Chapter %s' });
  });

  test('first chapter gets start: 1', () => {
    const fm: PageFrontmatter = { numbering: { book: { enabled: true } } };
    injectBookSectionDefaults(fm, 'chapters', true);
    expect(fm.numbering?.heading_1).toEqual({ start: 1, enabled: true, label: 'Chapter %s' });
  });

  test('appendices section seeds Alph format + Appendix label', () => {
    const fm: PageFrontmatter = { numbering: { book: { enabled: true } } };
    injectBookSectionDefaults(fm, 'appendices', false);
    expect(fm.numbering?.heading_1).toEqual({
      enabled: true,
      format: 'Alph',
      label: 'Appendix %s',
    });
  });

  test('first appendix gets start: 1 (counter reset on section transition)', () => {
    const fm: PageFrontmatter = { numbering: { book: { enabled: true } } };
    injectBookSectionDefaults(fm, 'appendices', true);
    expect(fm.numbering?.heading_1).toEqual({
      start: 1,
      enabled: true,
      format: 'Alph',
      label: 'Appendix %s',
    });
  });

  test('frontmatter section disables heading_1 (skip-semantic)', () => {
    const fm: PageFrontmatter = { numbering: { book: { enabled: true } } };
    injectBookSectionDefaults(fm, 'frontmatter', true);
    expect(fm.numbering?.heading_1?.enabled).toBe(false);
  });

  test('backmatter section disables heading_1', () => {
    const fm: PageFrontmatter = { numbering: { book: { enabled: true } } };
    injectBookSectionDefaults(fm, 'backmatter', false);
    expect(fm.numbering?.heading_1?.enabled).toBe(false);
  });

  test('does not clobber explicit author settings', () => {
    const fm: PageFrontmatter = {
      numbering: {
        book: { enabled: true },
        heading_1: { label: 'Section %s', format: 'roman' },
      },
    };
    injectBookSectionDefaults(fm, 'chapters', false);
    // author-set label and format are preserved
    expect(fm.numbering?.heading_1?.label).toBe('Section %s');
    expect(fm.numbering?.heading_1?.format).toBe('roman');
    // enabled is filled in (the default kicks in only when unset)
    expect(fm.numbering?.heading_1?.enabled).toBe(true);
  });
});
