export type CounterFormat = 'arabic' | 'alph' | 'Alph' | 'roman' | 'Roman';

/**
 * Accepted values for `numbering.<kind>.scope` (#27). The validator
 * normalises every spelling to `heading_N`; the alias forms are kept in
 * the union so authors can write the LaTeX-familiar names directly.
 * Source of truth for the alias map lives in
 * `myst-frontmatter/src/numbering/validators.ts` (`SCOPE_ALIASES`).
 */
export type NumberingScope =
  | 'chapter'
  | 'section'
  | 'subsection'
  | 'subsubsection'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'heading_4'
  | 'heading_5'
  | 'heading_6';

export type NumberingItem = {
  enabled?: boolean;
  start?: number;
  enumerator?: string;
  template?: string;
  continue?: boolean;
  offset?: number; // only applies to title
  format?: CounterFormat; // counter rendering format (arabic/alph/Alph/roman/Roman)
  label?: string; // cross-reference template, distinct from `template`
  reset_on_part?: boolean; // chapters: restart counter at each part (only meaningful on `chapters`)
  /**
   * Book-mode auto-prefix depth (#27). For kinds that pick up the
   * chapter/appendix prefix in `numbering.book: true` mode (figure,
   * equation, table, exercise, proof:*), `scope` controls which heading
   * depth contributes to the prefix and at which boundary the kind's
   * counter resets. Accepted values:
   *
   * - `chapter` (default) / `heading_1` — current behaviour: prefix is the
   *   page's chapter enumerator, counter resets on chapter boundary.
   *   Renders e.g. `Theorem 5.1, 5.2`.
   * - `section` / `heading_2` — LaTeX `\newtheorem{...}[section]` parity:
   *   prefix is `chapter.section`, counter resets on each new heading_2.
   *   Renders e.g. `Theorem 5.1.1, 5.1.2, 5.2.1`.
   * - `subsection` / `heading_3` … `heading_6` — deeper variants.
   *
   * For `proof:*` kinds, a `scope` set on the umbrella `proof` key applies
   * to every proof-family kind; per-kind `scope` (`numbering.proof:theorem.scope`)
   * wins. `numbering.all.scope` is the project-wide default.
   */
  scope?: NumberingScope;
};

/**
 * `book` is the opt-in flag for book-style numbering (PR #1, §3.2(0)).
 * It rides as a `NumberingItem`-shaped entry so the existing kind map stays
 * typed cleanly: `numbering: { book: true }` coerces to
 * `numbering.book = { enabled: true }` via `validateNumberingItem`, and
 * consumers test `numbering.book?.enabled === true` to gate book behaviour.
 */
export type Numbering = {
  book?: NumberingItem;
  enumerator?: NumberingItem; // start, enabled, continue, and template ignored
  all?: NumberingItem; // start, template, enumerator ignored
  title?: NumberingItem; // start, continue, and template ignored
  figure?: NumberingItem;
  subfigure?: NumberingItem;
  equation?: NumberingItem;
  subequation?: NumberingItem;
  table?: NumberingItem;
  code?: NumberingItem;
  parts?: NumberingItem;
  chapters?: NumberingItem;
  appendices?: NumberingItem;
  heading_1?: NumberingItem;
  heading_2?: NumberingItem;
  heading_3?: NumberingItem;
  heading_4?: NumberingItem;
  heading_5?: NumberingItem;
  heading_6?: NumberingItem;
} & Record<string, NumberingItem>;
