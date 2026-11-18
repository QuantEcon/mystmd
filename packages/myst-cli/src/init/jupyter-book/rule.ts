import type { ScannedDocument } from './blocks.js';

/**
 * What a rule may know about the project around the document it rewrites
 */
export type UpgradeContext = {
  /** Path of the document, relative to the project root, with `/` separators */
  path?: string;
  /** Every file in the project, relative to the project root, with `/` separators */
  files?: string[];
  /** Every target label defined in the project */
  labels?: string[];
  /** The `project.bibliography` entries of `myst.yml`, when there is one */
  bibliography?: string[];
};

type Location = {
  /** Path of the document, relative to the project root */
  file?: string;
  /** Index of the notebook cell, for a notebook */
  cell?: number;
  /** 1-based line of the source as it was before any rule ran */
  line: number;
  rule: string;
};

export type UpgradeChange = Location & {
  before: string;
  after: string;
};

export type UpgradeIssue = Location & {
  message: string;
};

export type UpgradeReport = {
  /** Each rewrite that was made */
  changes: UpgradeChange[];
  /** Constructs a rule recognised but cannot convert; any failure means nothing is written */
  failures: UpgradeIssue[];
  /** Constructs a rule recognised and left untouched on purpose */
  skips: UpgradeIssue[];
  /** Anything else the author should know, such as a project setting a rewrite relies on */
  notices: UpgradeIssue[];
};

export function createUpgradeReport(): UpgradeReport {
  return { changes: [], failures: [], skips: [], notices: [] };
}

export type RuleAPI = {
  context: UpgradeContext;
  /** The blocks of the document, scanned before the rule runs */
  doc: ScannedDocument;
  /**
   * Replace the lines `[start, end)` (0-based) with `replacement`
   *
   * Edits apply once the rule has run, so every index refers to the lines the
   * rule was given. The edits of one rule must not overlap.
   */
  replace(start: number, end: number, replacement: string[]): void;
  /** Record a rewrite at a 0-based line */
  change(line: number, before: string, after: string): void;
  /** Record a construct that cannot be converted, at a 0-based line */
  fail(line: number, message: string): void;
  /** Record a construct that is left untouched on purpose, at a 0-based line */
  skip(line: number, message: string): void;
  /** Record a note for the author, at a 0-based line */
  notice(line: number, message: string): void;
};

/**
 * One rewrite rule of the Jupyter Book upgrade
 */
export type UpgradeRule = {
  /** The name used in reports */
  name: string;
  run(lines: string[], api: RuleAPI): void;
};

/**
 * Join lines for a report entry
 */
export function excerpt(lines: string[]): string {
  return lines.join('\n');
}
