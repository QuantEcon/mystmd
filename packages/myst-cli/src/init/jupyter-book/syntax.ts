import { mystParse } from 'myst-parser';
import fs from 'node:fs/promises';
import { glob } from 'glob';
import { selectAll } from 'unist-util-select';
import { toText } from 'myst-common';
import chalk from 'chalk';
import type { ISession } from '../../session/types.js';
import { makeExecutable } from 'myst-cli-utils';
import { parse, join, sep } from 'node:path';
import type { INotebookContent } from '@jupyterlab/nbformat';
import { scanDocument } from './blocks.js';
import type { RuleAPI, UpgradeContext, UpgradeReport, UpgradeRule } from './rule.js';
import { createUpgradeReport } from './rule.js';
import { UPGRADE_RULES, collectLabels } from './rules/index.js';

export type { UpgradeChange, UpgradeContext, UpgradeIssue, UpgradeReport } from './rule.js';
export { createUpgradeReport } from './rule.js';

// Preserve newlines through group construct
const SPLIT_PATTERN = /\r\n|\r|\n/;
type DocumentLine = {
  content: string;
  offset: number;
};

type LegacyGlossaryItem = {
  termLines: DocumentLine[];
  definitionLines: DocumentLine[];
};
type ChangeCallback = (line: number, before: string, after: string) => void;

const IGNORED_PATHS = ['**/_build/**', '**/node_modules/**', '**/.git/**'];

/**
 * Every file in the project, relative to the working directory, with `/` separators
 *
 * Git-tracked files are preferred, to ignore build outputs; otherwise the
 * directory is globbed.
 */
async function listProjectFiles(): Promise<string[]> {
  let files: string[];
  try {
    files = (await makeExecutable('git ls-files', null)())
      .split(SPLIT_PATTERN)
      .filter((path) => !!path);
  } catch (error) {
    // Fall back on globbing
    files = await glob('**/*', { nodir: true, ignore: IGNORED_PATHS });
  }
  return files.map((path) => path.split(sep).join('/')).sort();
}

export type SyntaxUpgradeOptions = {
  /** The `project.bibliography` entries the upgraded project will have, if known */
  bibliography?: string[];
  /** The inventory names of the project's intersphinx mapping, if known */
  intersphinx?: string[];
};

export type SyntaxUpgradePlan = {
  report: UpgradeReport;
  /** The documents to rewrite, with their new content */
  pending: { path: string; content: string }[];
};

type DocumentSource =
  | { kind: 'markdown'; path: string; data: string }
  | { kind: 'notebook'; path: string; notebook: INotebookContent };

async function readDocument(path: string): Promise<DocumentSource | undefined> {
  const { ext } = parse(path);
  const data = (await fs.readFile(path)).toString();
  if (ext === '.md') return { kind: 'markdown', path, data };
  if (ext === '.ipynb') return { kind: 'notebook', path, notebook: JSON.parse(data) };
  return undefined;
}

/**
 * Notebook markdown cell sources, as lines without their newlines
 */
function cellLines(cell: INotebookContent['cells'][number]): string[] {
  const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source as string);
  return source.split(SPLIT_PATTERN);
}

/**
 * Work out every syntax upgrade in the project, without writing anything
 *
 * @param session - session with logging
 * @param opts - what is known of the upgraded project's configuration
 */
export async function planProjectSyntaxUpgrade(
  session: ISession,
  opts: SyntaxUpgradeOptions = {},
): Promise<SyntaxUpgradePlan> {
  const files = await listProjectFiles();
  const documentPaths = files.filter((path) => {
    const { ext } = parse(path);
    return ext == '.md' || ext == '.ipynb';
  });
  const documents = (await Promise.all(documentPaths.map(readDocument))).filter(
    (doc): doc is DocumentSource => !!doc,
  );

  // Every label in the project, for the rules that resolve links
  const labels = new Set<string>();
  documents.forEach((doc) => {
    const sources =
      doc.kind === 'markdown'
        ? [doc.data.split(SPLIT_PATTERN)]
        : doc.notebook.cells.filter((cell) => cell.cell_type === 'markdown').map(cellLines);
    sources.forEach((lines) => {
      collectLabels(lines).forEach((label) => {
        labels.add(label);
      });
    });
  });
  const sortedLabels = [...labels].sort();

  const report = createUpgradeReport();
  const pending: SyntaxUpgradePlan['pending'] = [];
  for (const doc of documents) {
    const context: UpgradeContext = {
      path: doc.path,
      files,
      labels: sortedLabels,
      bibliography: opts.bibliography,
      intersphinx: opts.intersphinx,
    };
    if (doc.kind === 'markdown') {
      // Upgrade entire Markdown document in one pass
      const eol = doc.data.includes('\r\n') ? '\r\n' : '\n';
      const maybeNewLines = await upgradeContent(doc.data.split(SPLIT_PATTERN), {
        context,
        report,
      });
      if (maybeNewLines !== undefined) {
        pending.push({ path: doc.path, content: maybeNewLines.join(eol) });
      }
    } else {
      // Upgrade each markdown cell of the notebook; code cells are not reached
      let didUpgrade = false;
      for (const [index, cell] of doc.notebook.cells.entries()) {
        if (cell.cell_type !== 'markdown') continue;
        const maybeNewLines = await upgradeContent(cellLines(cell), {
          context,
          report,
          cell: index,
        });
        if (maybeNewLines !== undefined) {
          cell.source = maybeNewLines.map((line, i) =>
            i < maybeNewLines.length - 1 ? `${line}\n` : line,
          );
          didUpgrade = true;
        }
      }
      if (didUpgrade) {
        pending.push({ path: doc.path, content: JSON.stringify(doc.notebook) });
      }
    }
  }
  return { report, pending };
}

/**
 * Write the documents of an upgrade plan
 *
 * @param session - session with logging
 * @param plan - the plan to write
 * @param opts.backup - keep each original beside it, as `.<name>.bak`
 */
export async function writeProjectSyntaxUpgrade(
  session: ISession,
  plan: SyntaxUpgradePlan,
  opts: { backup?: boolean } = {},
) {
  const backup = opts.backup ?? true;
  for (const { path, content } of plan.pending) {
    if (backup) {
      const { base, dir } = parse(path);
      await fs.copyFile(path, join(dir, `.${base}.bak`));
    }
    await fs.writeFile(path, content);
    session.log.info(chalk.dim(`Upgraded ${chalk.blue(path)}`));
  }
}

/**
 * Format the failures of a report, one per line, as `file:line: [rule] message`
 */
export function formatUpgradeIssues(issues: UpgradeReport['failures']): string {
  return issues
    .map(({ file, cell, line, rule, message }) => {
      const where = cell === undefined ? `${file ?? ''}:${line}` : `${file}:cell ${cell}:${line}`;
      return `${where}: [${rule}] ${message}`;
    })
    .join('\n');
}

/**
 * In-place upgrade legacy Jupyter Book syntax in all MyST documents
 *
 * Nothing is written when any rule fails: the failures are thrown together.
 *
 * @param session - session with logging
 */
export async function upgradeProjectSyntax(session: ISession, opts: SyntaxUpgradeOptions = {}) {
  session.log.debug(chalk.dim(`Upgrading legacy-formatted files`));
  const plan = await planProjectSyntaxUpgrade(session, opts);
  if (plan.report.failures.length) {
    throw new Error(
      `Some syntax could not be upgraded, so no file was changed:\n${formatUpgradeIssues(
        plan.report.failures,
      )}`,
    );
  }
  await writeProjectSyntaxUpgrade(session, plan);
}

/**
 * The legacy transforms, which rewrite whole documents: they run after the rules
 */
const LEGACY_RULES: UpgradeRule[] = [
  {
    name: 'glossary',
    run(lines, api) {
      const result = upgradeGlossary([...lines], (line, before, after) =>
        api.change(line, before, after),
      );
      if (result) api.replace(0, lines.length, result);
    },
  },
  {
    name: 'admonition-case',
    run(lines, api) {
      const result = upgradeNotes([...lines], (line, before, after) =>
        api.change(line, before, after),
      );
      if (result) api.replace(0, lines.length, result);
    },
  },
];

type Edit = { start: number; end: number; replacement: string[] };

function applyEdits(lines: string[], origin: number[], edits: Edit[], rule: string) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      throw new Error(`Upgrade rule "${rule}" made overlapping edits`);
    }
  }
  const nextLines = [...lines];
  const nextOrigin = [...origin];
  for (const { start, end, replacement } of sorted.reverse()) {
    const anchor = origin[start] ?? origin[origin.length - 1] ?? 0;
    nextLines.splice(start, end - start, ...replacement);
    nextOrigin.splice(start, end - start, ...replacement.map(() => anchor));
  }
  return { lines: nextLines, origin: nextOrigin };
}

/**
 * Upgrade the legacy syntax of one document
 *
 * @param documentLines - the lines of the document
 * @param opts.context - what is known about the project around the document
 * @param opts.report - collects each change, failure and skip
 * @param opts.cell - the notebook cell the lines come from, for reports
 * @param opts.rules - the rules to run, by default every rule
 * @returns the new lines, or `undefined` when nothing changed
 */
export async function upgradeContent(
  documentLines: string[],
  opts: {
    context?: UpgradeContext;
    report?: UpgradeReport;
    cell?: number;
    rules?: UpgradeRule[];
  } = {},
): Promise<string[] | undefined> {
  const context = opts.context ?? {};
  const report = opts.report ?? createUpgradeReport();
  const rules = opts.rules ?? [...UPGRADE_RULES, ...LEGACY_RULES];
  let lines = [...documentLines];
  let origin = lines.map((_, index) => index);
  let didUpgrade = false;

  for (const rule of rules) {
    const edits: Edit[] = [];
    const locate = (line: number) => ({
      file: context.path,
      cell: opts.cell,
      line: (origin[line] ?? origin[origin.length - 1] ?? 0) + 1,
      rule: rule.name,
    });
    const api: RuleAPI = {
      context,
      doc: scanDocument(lines),
      replace: (start, end, replacement) => edits.push({ start, end, replacement }),
      change: (line, before, after, note) =>
        report.changes.push({ ...locate(line), before, after, ...(note ? { note } : {}) }),
      fail: (line, message) => report.failures.push({ ...locate(line), message }),
      skip: (line, message) => report.skips.push({ ...locate(line), message }),
      notice: (line, message) => report.notices.push({ ...locate(line), message }),
    };
    rule.run(lines, api);
    if (!edits.length) continue;
    const next = applyEdits(lines, origin, edits, rule.name);
    if (next.lines.join('\n') !== lines.join('\n')) didUpgrade = true;
    ({ lines, origin } = next);
  }

  return didUpgrade ? lines : undefined;
}

const admonitionPattern =
  /^(attention|caution|danger|error|important|hint|note|seealso|tip|warning)$/;

function upgradeNotes(documentLines: string[], onChange?: ChangeCallback): string[] | undefined {
  const data = documentLines.join('\n');
  const mdast = mystParse(data);

  const caseInsensitivePattern = new RegExp(
    admonitionPattern.source,
    admonitionPattern.flags + 'i',
  );
  const directiveNodes = selectAll('mystDirective', mdast);
  const mixedCaseAdmonitions = directiveNodes.filter((item) => {
    const name = (item as any).name as string;
    return name.match(caseInsensitivePattern) && !name.match(admonitionPattern);
  });
  mixedCaseAdmonitions.forEach((node) => {
    const start = node.position!.start.line;

    // Find declaration immediately _above_ body node
    const newLine = documentLines[start - 1].replace(
      // Find :::{fOo} or ```{fOo}
      // eslint-disable-next-line no-useless-escape
      /^(:{3,}|`{3,})\s*\{([^\}]+)\}/,
      // Replace it with :::{foo} or ```{foo}
      (_, prefix, name) => `${prefix}{${name.toLowerCase()}}`,
    );
    onChange?.(start - 1, documentLines[start - 1], newLine);
    documentLines[start - 1] = newLine;
  });

  // Update the file
  if (mixedCaseAdmonitions.length) {
    return documentLines;
  } else {
    return undefined;
  }
}

function upgradeGlossary(documentLines: string[], onChange?: ChangeCallback): string[] | undefined {
  const data = documentLines.join('\n');
  const mdast = mystParse(data);
  const glossaryNodes = selectAll('mystDirective[name=glossary]', mdast);

  // Track the edit point
  let editOffset = 0;
  let didUpgrade = false;
  for (const node of glossaryNodes) {
    const nodeLines = ((node as any).value as string).split(SPLIT_PATTERN);

    // A glossary that is already a MyST definition list is left alone
    if (nodeLines.some((line) => /^:\s/.test(line))) continue;

    // TODO: assert span items

    // Flag tracking whether the line-processor expects definition lines
    let inDefinition = false;
    let indentSize = 0;

    const entries: LegacyGlossaryItem[] = [];

    // Parse lines into separate entries
    for (let i = 0; i < nodeLines.length; i++) {
      const line = nodeLines[i];
      // Is the line a comment?
      if (/^\.\.\s/.test(line) || !line.length) {
        continue;
      }
      // Is the line a non-whitespace-leading line (term declaration)?
      else if (/^[^\s]/.test(line[0])) {
        // Comment
        if (line.startsWith('.. ')) {
          continue;
        }

        // Do we need to create a new entry?
        if (inDefinition || !entries.length) {
          // Close the current definition, open a new term
          entries.push({
            definitionLines: [],
            termLines: [{ content: line, offset: i }],
          });
          inDefinition = false;
        }
        // Can we extend existing entry with an additional term?
        else if (entries.length) {
          entries[entries.length - 1].termLines.push({ content: line, offset: i });
        }
      }
      // Open a definition
      else {
        inDefinition = true;
        indentSize = line.length - line.replace(/^\s+/, '').length;

        if (entries.length) {
          entries[entries.length - 1].definitionLines.push({
            content: line.slice(indentSize),
            offset: i,
          });
        }
      }
    }

    // Build glossary
    const newLines: string[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const { termLines, definitionLines } = entry;

      const [firstDefinitionLine, ...restDefinitionLines] = definitionLines;
      const [firstTerm, ...restTerms] = termLines;

      // Initial definition
      const firstTermValue = firstTerm.content.split(/\s+:\s+/, 1)[0];
      newLines.push(
        firstTermValue,
        `: ${firstDefinitionLine.content}`,
        ...restDefinitionLines.map((line) => `  ${line.content}`),
      );
      if (restTerms) {
        // Terms can contain markup, but we need the text-form to create a term reference
        // TODO: what if something magical like an xref is used here? Assume not.
        const parsedTerm = mystParse(firstTermValue);
        const termName = toText(parsedTerm);
        for (const { content } of restTerms) {
          const term = content.split(/\s+:\s+/, 1)[0];
          newLines.push(
            // Separate from parent term
            '',
            term,
            `: {term}\`${termName}\``,
          );
        }
      }

      // Will there be following terms?
      const isFinalEntry = i === entries.length - 1;
      if (!isFinalEntry) {
        newLines.push('');
      }
    }
    const nodeSpan = { start: node.position?.start?.line, stop: node.position?.end?.line };
    const spanLength = nodeSpan.stop! - nodeSpan.start! - 1;
    onChange?.(
      nodeSpan.start! - 1,
      documentLines.slice(nodeSpan.start! + editOffset, nodeSpan.stop! - 1 + editOffset).join('\n'),
      newLines.join('\n'),
    );
    documentLines.splice(nodeSpan.start! + editOffset, spanLength, ...newLines);

    // Offset our insert cursor
    editOffset += newLines.length - spanLength;
    didUpgrade = true;
  }

  // Update the file
  if (didUpgrade) {
    return documentLines;
  } else {
    return undefined;
  }
}
