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

  // #25: chapter-prefix machinery needs the full chain title → heading_1 →
  // heading_2 → heading_3 enabled. Without these defaults, qe-v2 produced
  // flat figure / section numbering on chapter pages (`1` instead of `1.1`)
  // because the absorbed title H1 wasn't numbered and the prefix couldn't
  // compose. The matching frontmatter/backmatter side seeds `false` so
  // a project-level `heading_2.enabled: true` (needed for chapters) does
  // not leak through and number the preface's `##` headings.

  test('chapters seeds the title → heading_1 → heading_2 → heading_3 chain (#25)', () => {
    const fm: PageFrontmatter = { numbering: { book: { enabled: true } } };
    injectBookSectionDefaults(fm, 'chapters', false);
    expect(fm.numbering?.title?.enabled).toBe(true);
    expect(fm.numbering?.heading_1?.enabled).toBe(true);
    expect(fm.numbering?.heading_2?.enabled).toBe(true);
    expect(fm.numbering?.heading_3?.enabled).toBe(true);
  });

  test('appendices seeds the title → heading_1 → heading_2 → heading_3 chain (#25)', () => {
    const fm: PageFrontmatter = { numbering: { book: { enabled: true } } };
    injectBookSectionDefaults(fm, 'appendices', false);
    expect(fm.numbering?.title?.enabled).toBe(true);
    expect(fm.numbering?.heading_1?.enabled).toBe(true);
    expect(fm.numbering?.heading_2?.enabled).toBe(true);
    expect(fm.numbering?.heading_3?.enabled).toBe(true);
  });

  test('frontmatter disables the full chain (#25 side-issue)', () => {
    const fm: PageFrontmatter = { numbering: { book: { enabled: true } } };
    injectBookSectionDefaults(fm, 'frontmatter', false);
    expect(fm.numbering?.title?.enabled).toBe(false);
    expect(fm.numbering?.heading_1?.enabled).toBe(false);
    expect(fm.numbering?.heading_2?.enabled).toBe(false);
    expect(fm.numbering?.heading_3?.enabled).toBe(false);
  });

  test('backmatter disables the full chain (#25 side-issue)', () => {
    const fm: PageFrontmatter = { numbering: { book: { enabled: true } } };
    injectBookSectionDefaults(fm, 'backmatter', false);
    expect(fm.numbering?.title?.enabled).toBe(false);
    expect(fm.numbering?.heading_1?.enabled).toBe(false);
    expect(fm.numbering?.heading_2?.enabled).toBe(false);
    expect(fm.numbering?.heading_3?.enabled).toBe(false);
  });

  test('section defaults seed false for frontmatter even when project enables h2', () => {
    // Before #25's fix, a project enabling heading_2 (a workaround for
    // chapter prefixing) would leak through to frontmatter pages and
    // number the preface's `##` headings as 1, 2, 3. Now the section
    // default explicitly seeds heading_2.enabled = false for frontmatter,
    // so the preface stays unnumbered regardless of project config.
    //
    // (Project-level numbering merges happen after this function runs in
    // the full pipeline, but the section-default false acts as the page-
    // local override — closer to the page beats the project setting.)
    const fm: PageFrontmatter = {
      numbering: {
        book: { enabled: true },
        // heading_2 not yet present on the page; section default fills it
      },
    };
    injectBookSectionDefaults(fm, 'frontmatter', false);
    expect(fm.numbering?.heading_2?.enabled).toBe(false);
  });

  test('page override wins on a chapter page: disabling heading_2 is preserved', () => {
    // An author wants a chapter page where `## Section` headings stay
    // unnumbered. They write `numbering.heading_2.enabled: false` in
    // page frontmatter. The section default uses ??=, so the page wins.
    const fm: PageFrontmatter = {
      numbering: {
        book: { enabled: true },
        heading_2: { enabled: false },
      },
    };
    injectBookSectionDefaults(fm, 'chapters', false);
    expect(fm.numbering?.heading_2?.enabled).toBe(false); // page wins
    // other defaults still apply
    expect(fm.numbering?.heading_1?.enabled).toBe(true);
    expect(fm.numbering?.heading_3?.enabled).toBe(true);
  });

  test('page override wins on a frontmatter page: enabling title is preserved', () => {
    // The other direction: an author has a `Preface` they want numbered
    // as part of the chapter sequence ("Chapter 0: Preface"). They write
    // `numbering.heading_1: { enabled: true, start: 0, label: "Chapter %s" }`.
    // The section default uses ??=, so the page wins and the preface
    // gets numbered despite being tagged `section: frontmatter`.
    //
    // This is the symmetry fix: the legacy `h1.enabled = false` (hard
    // assignment) made this impossible.
    const fm: PageFrontmatter = {
      numbering: {
        book: { enabled: true },
        heading_1: { enabled: true, start: 0, label: 'Chapter %s' },
        title: { enabled: true },
      },
    };
    injectBookSectionDefaults(fm, 'frontmatter', false);
    expect(fm.numbering?.heading_1?.enabled).toBe(true); // page wins
    expect(fm.numbering?.heading_1?.start).toBe(0);
    expect(fm.numbering?.heading_1?.label).toBe('Chapter %s');
    expect(fm.numbering?.title?.enabled).toBe(true); // page wins
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
