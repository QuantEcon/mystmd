export type CounterFormat = 'arabic' | 'alph' | 'Alph' | 'roman' | 'Roman';

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
