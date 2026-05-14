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

  test('numbering.chapters.label flows into heading_1', () => {
    // Copilot review #2: a project setting `numbering.chapters.label`
    // should reach pages in `section: chapters` instead of being
    // silently ignored in favour of the hardcoded "Chapter %s".
    const fm: PageFrontmatter = {
      numbering: {
        book: { enabled: true },
        chapters: { label: 'Module %s' },
      },
    };
    injectBookSectionDefaults(fm, 'chapters', false);
    expect(fm.numbering?.heading_1?.label).toBe('Module %s');
  });

  test('numbering.appendices.format flows into heading_1', () => {
    const fm: PageFrontmatter = {
      numbering: {
        book: { enabled: true },
        appendices: { format: 'roman' },
      },
    };
    injectBookSectionDefaults(fm, 'appendices', false);
    // section config beats the hardcoded `Alph` default
    expect(fm.numbering?.heading_1?.format).toBe('roman');
    // hardcoded label still fills in because section didn't set one
    expect(fm.numbering?.heading_1?.label).toBe('Appendix %s');
  });

  test('page heading_1 beats section config beats hardcoded default', () => {
    const fm: PageFrontmatter = {
      numbering: {
        book: { enabled: true },
        chapters: { label: 'Module %s', format: 'roman' },
        // page-level wins for label; format comes from section config
        heading_1: { label: 'Lesson %s' },
      },
    };
    injectBookSectionDefaults(fm, 'chapters', false);
    expect(fm.numbering?.heading_1?.label).toBe('Lesson %s'); // page wins
    expect(fm.numbering?.heading_1?.format).toBe('roman'); // section wins over hardcoded
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
