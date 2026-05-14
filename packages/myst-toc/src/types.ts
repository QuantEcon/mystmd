/**
 * Named book sections for `section:` on a ParentEntry. Pages under a
 * `section`-tagged subtree inherit the section's numbering defaults
 * (chapters → arabic, appendices → Alph, etc.) once `numbering.book: true`
 * is set on the project.
 *
 * `parts` is structural — it emits a divider with a Roman-numbered title
 * ("Part I — General Theory") and its children default to `section: chapters`.
 * The other sections are logical wrappers (no divider, same level).
 */
export type BookSection = 'frontmatter' | 'parts' | 'chapters' | 'appendices' | 'backmatter';

/**
 * Common attributes for all TOC items
 * Should be taken as a Partial<>
 */
export type CommonEntry = {
  title?: string;
  hidden?: boolean;
  /**
   * Book-style section tag. When set on a ParentEntry, every descendant
   * page is treated as belonging to that named section for numbering
   * purposes. Only meaningful when project `numbering.book: true`.
   */
  section?: BookSection;
  // numbering?: string;
  // id?: string;
  // class?: string;
};

/**
 * Entry that groups children, with no associated document
 */
export type ParentEntry = {
  children: Entry[];
  title: string;
} & CommonEntry;

/**
 * Entry with a path to a single document with or without the file extension
 */
export type FileEntry = {
  file: string;
} & CommonEntry;

/**
 * Entry with a path to a single document with or without the file extension,
 * and an array of children
 */
export type FileParentEntry = FileEntry & Omit<ParentEntry, 'title'>;

/**
 * Entry with a url to an external resource
 */
export type URLEntry = {
  url: string;
  open_in_same_tab?: boolean;
} & CommonEntry;

/**
 * Entry with a url to an external resource,
 * and an array of children
 */
export type URLParentEntry = URLEntry & Omit<ParentEntry, 'title'>;

/**
 * Entry representing several documents through a glob
 */
export type PatternEntry = {
  pattern: string;
  sort?: 'ascending' | 'descending';
} & CommonEntry;

/**
 * All possible types of Entry
 */
export type Entry =
  | FileEntry
  | URLEntry
  | FileParentEntry
  | URLParentEntry
  | PatternEntry
  | ParentEntry;

export type TOC = Entry[];
