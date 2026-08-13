import type { Plugin } from 'unified';
import type { VFile } from 'vfile';
import katex from 'katex';
import 'katex/contrib/mhchem';
import type { InlineMath, Node } from 'myst-spec';
import type { Math } from 'myst-spec-ext';
import { selectAll } from 'unist-util-select';
import type { GenericParent } from 'myst-common';
import { RuleId, copyNode, fileError, fileWarn, normalizeLabel } from 'myst-common';
import type { PageFrontmatter } from 'myst-frontmatter';
import { unnestTransform } from './unnest.js';
import { buildRowTex, scanMathRows } from './mathRows.js';

const TRANSFORM_NAME = 'myst-transforms:math';

type Options = {
  macros?: Required<PageFrontmatter>['math'];
  mathML?: boolean;
};

const replacements = {
  ' ': ' ',
};

const builtInMacros = {
  '\\mbox': '\\text{#1}', // mbox is not supported in KaTeX, this is an OK fallback
};

function transformMathValue(file: VFile, node: Math | InlineMath) {
  let { value } = node;
  if (!value) return undefined;
  Object.entries(replacements).forEach(([from, to]) => {
    value = value.replace(new RegExp(from, 'g'), to);
  });
  node.value = value;
}

function labelMathNodes(file: VFile, node: Math | InlineMath) {
  const { value } = node;
  if (!value) return;
  // Pull out all the labels from the latex
  const LABEL = /\\label\{([^}]+)\}/g;
  const match = LABEL.exec(value);
  if (!match) return value;
  const label = match[1];
  const normalized = normalizeLabel(label);
  if (node.type === 'math' && normalized) {
    if (node.label) {
      fileWarn(
        file,
        `Math node is already labeled "${node.label}" - ignoring inline "\\label{${label}}"`,
        {
          node,
          source: TRANSFORM_NAME,
          ruleId: RuleId.mathLabelLifted,
        },
      );
    } else {
      if (node.enumerated === false) {
        fileWarn(file, `Labelling an unnumbered math node with "\\label{${label}}"`, {
          node,
          source: TRANSFORM_NAME,
          ruleId: RuleId.mathLabelLifted,
        });
      }
      node.identifier = normalized.identifier;
      node.label = normalized.label;
      (node as any).html_id = normalized.html_id;
    }
  } else if (node.type === 'inlineMath') {
    fileWarn(file, `Cannot use "\\label{${label}}" in inline math`, {
      node,
      source: TRANSFORM_NAME,
      ruleId: RuleId.mathLabelLifted,
    });
  }
  node.value = value.replace(LABEL, '').trim();
}

/**
 * Extract per-row numbering structure from row-numbering amsmath environments
 * (align/gather/alignat), following amsmath semantics: each `\\` row takes its
 * own number, `\nonumber`/`\notag` suppresses a row's number, `\tag{...}`
 * replaces it, and a per-row `\label{...}` anchors that row.
 *
 * Per-row labels are stripped from the value (mirroring `labelMathNodes`) and
 * recorded on `node.rows`; enumerators are assigned later during enumeration,
 * and the HTML is re-rendered with injected `\tag`s after that.
 *
 * Single-row environments keep block-level numbering semantics (identical in
 * amsmath), so existing anchors and rendering are unchanged for them.
 */
function extractMathRows(file: VFile, node: Math) {
  const scan = scanMathRows(node.value);
  if (!scan) return;
  scan.rows.forEach((row) => {
    const rawLabels = row.labels;
    delete row.labels;
    if (!rawLabels?.length) return;
    if (rawLabels.length > 1) {
      fileWarn(
        file,
        `Math row has multiple labels ["${rawLabels.join('", "')}"] - using "${rawLabels[0]}"`,
        { node, source: TRANSFORM_NAME, ruleId: RuleId.mathLabelLifted },
      );
    }
    const normalized = normalizeLabel(rawLabels[0]);
    if (!normalized) return;
    row.identifier = normalized.identifier;
    row.label = normalized.label;
    row.html_id = normalized.html_id;
  });
  const { labelsStripped, ...info } = scan;
  if (labelsStripped) node.value = buildRowTex(info);
  if (info.rows.length < 2) {
    const row = info.rows[0];
    if (!row) return;
    if (row.identifier) {
      if (node.label) {
        fileWarn(
          file,
          `Math node is already labeled "${node.label}" - ignoring inline "\\label{${row.label}}"`,
          { node, source: TRANSFORM_NAME, ruleId: RuleId.mathLabelLifted },
        );
      } else {
        node.identifier = row.identifier;
        node.label = row.label;
        (node as any).html_id = row.html_id;
      }
    }
    if (
      (info.starred || row.nonumber) &&
      node.enumerated == null &&
      !node.identifier &&
      !row.identifier
    ) {
      // amsmath: starred environments and \nonumber rows are unnumbered
      node.enumerated = false;
    } else if (row.tag && !(node as any).enumerator) {
      // amsmath: \tag replaces the number without advancing the counter
      (node as any).enumerator = row.tag;
    }
    return;
  }
  if (info.starred) {
    // Starred environments are unnumbered; rows only matter if they carry
    // explicit tags or labels (amsmath allows \tag in starred forms).
    if (node.enumerated == null && !node.identifier) node.enumerated = false;
    if (!info.rows.some((row) => row.tag || row.identifier)) return;
  }
  node.rows = info;
}

function removeSimpleEquationEnv(file: VFile, node: Math | InlineMath) {
  const { value } = node;
  if (!value) return;
  // For simple equation environments, pull that out
  const BEGIN = /\\begin\{equation([*]?)\}/g;
  const END = /\\end\{equation([*]?)\}/g;
  if (value.match(BEGIN)?.length !== 1 || value.match(END)?.length !== 1) return;
  if (node.type === 'inlineMath') {
    fileWarn(file, `Unexpected AMS environment in inline math node.`, {
      node,
      note: value,
      source: TRANSFORM_NAME,
      ruleId: RuleId.mathEquationEnvRemoved,
    });
    return;
  }
  const beginStar = BEGIN.exec(value)?.[1] === '*';
  const endStar = END.exec(value)?.[1] === '*';
  if (beginStar !== endStar) {
    // Should never get to here as the parser should not accept mismatched ends
    fileWarn(file, `Mismatching begin/end environment numbering`, {
      node,
      note: value,
      source: TRANSFORM_NAME,
      ruleId: RuleId.mathEquationEnvRemoved,
    });
    return;
  }
  node.enumerated = !beginStar;
  node.value = value.replace(BEGIN, '').replace(END, '').trim();
}

function replaceEqnarray(file: VFile, value: string, node: Node) {
  if (!value.includes('\\begin{eqnarray}')) return value;
  fileWarn(file, 'Replacing \\begin{eqnarray} with \\begin{align*}', {
    node,
    note: 'Although the standard eqnarray environment is available in LaTeX, it is better to use align or equation+split instead. Within eqnarray, spacing around signs of relation is not the preferred mathematical spacing, and is inconsistent with that spacing as it appears in other environments.',
    source: TRANSFORM_NAME,
    url: 'http://anorien.csc.warwick.ac.uk/mirrors/CTAN/macros/latex/required/amsmath/amsldoc.pdf',
    ruleId: RuleId.mathEqnarrayReplaced,
  });
  return value
    .replace(/\\begin{eqnarray}/g, '\\begin{align*}')
    .replace(/\\end{eqnarray}/g, '\\end{align*}')
    .replace(/&=&/g, '&=');
}

type RenderResult = { html?: string; warnings?: string[]; error?: string };

function removeWarnings(result: RenderResult, predicate: (warning: string) => boolean) {
  const { warnings, ...rest } = result;
  if (!warnings) return rest;
  const nextWarnings = warnings.filter(predicate);
  if (nextWarnings.length === 0) return rest;
  return {
    ...rest,
    warnings: nextWarnings,
  };
}

function tryRender(file: VFile, node: Node, value: string, opts?: Options): RenderResult {
  const displayMode = node.type === 'math';
  const warnings: string[] = [];
  let simplifiedMacros: Record<string, string> = {};
  if (opts?.macros) {
    simplifiedMacros = Object.fromEntries(
      Object.entries(opts.macros).map(([k, v]) => [k, v.macro]),
    );
  }
  try {
    const html = katex.renderToString(value, {
      displayMode,
      output: opts?.mathML ? 'mathml' : undefined,
      macros: { ...builtInMacros, ...simplifiedMacros },
      strict: (f: string, m: string) => {
        if (f === 'newLineInDisplayMode') return;
        warnings.push(`${f}, ${m}`);
      },
    });
    if (warnings.length === 0) return { html };
    return { warnings, html };
  } catch (error) {
    const { message } = error as unknown as Error;
    if (message.includes("Expected 'EOF', got '&' at position")) {
      fileWarn(file, 'Wrapping with \\begin{align*}', {
        node,
        note: message,
        source: TRANSFORM_NAME,
        ruleId: RuleId.mathAlignmentAdjusted,
      });
      const next = `\\begin{align*}\n${value}\n\\end{align*}`;
      const result = tryRender(file, node, next, opts);
      if (result.html) return result;
    }
    if (message.includes('Unknown column alignment: *')) {
      fileWarn(file, 'Alignment of "*" not supported, using "c"', {
        node,
        note: message,
        source: TRANSFORM_NAME,
        ruleId: RuleId.mathAlignmentAdjusted,
      });
      const arrayCentering = /\\begin{array}{((?:\*\{[0-9]+\})c)}/g;
      if (value.match(arrayCentering)) {
        const next = value.replace(arrayCentering, '\\begin{array}{c}');
        const result = tryRender(file, node, next, opts);
        if (result.html) {
          // We expect, and remove some errors
          return removeWarnings(result, (w) => !w.includes('Too few columns specified'));
        }
      }
    }
    return { error: message.replace('KaTeX parse error: ', '') };
  }
}

export function renderEquation(file: VFile, node: Math | InlineMath, opts?: Options) {
  // Row-numbered environments render as the starred (unnumbered) form with
  // explicit per-row `\tag{...}`s injected for enumerated rows. This keeps the
  // shared alignment axis while showing amsmath-style per-row numbers, and
  // avoids KaTeX's automatic CSS-counter numbering (which cannot express
  // book-mode enumerators). Before enumeration runs, rows have no enumerators
  // yet and this renders the plain starred environment.
  let value =
    node.type === 'math' && node.rows
      ? buildRowTex(node.rows, { starred: true, injectTags: true })
      : node.value;
  if (!value) {
    const message = 'No input for math node';
    fileWarn(file, message, {
      node,
      note: node.value,
      source: TRANSFORM_NAME,
      fatal: true,
      ruleId: RuleId.mathRenders,
    });
    (node as any).error = true;
    (node as any).message = message;
    return;
  }
  value = replaceEqnarray(file, value, node);
  const result = tryRender(file, node, value, opts);
  if (result.html) {
    (node as any).html = result.html;
  }
  if (result.warnings) {
    result.warnings.forEach((message) => {
      fileWarn(file, message, {
        node,
        note: node.value,
        source: 'KaTeX',
        ruleId: RuleId.mathRenders,
      });
    });
  }
  if (result.error) {
    const nodeError = copyNode(node);
    const match = result.error.match(/position ([0-9]+):/);
    if (match && nodeError.position) {
      const offset = Number(match[1]);
      const lines = node.value.slice(0, offset).split('\n');
      const newLines = lines.length - 1;
      nodeError.position.start.line += newLines;
      if (newLines > 0) {
        nodeError.position.start.column = lines[newLines].length;
      } else {
        nodeError.position.start.column += offset - 1;
      }
    }
    fileError(file, result.error, {
      node: nodeError,
      note: node.value,
      source: 'KaTeX',
      ruleId: RuleId.mathRenders,
    });
    (node as any).error = true;
    (node as any).message = result.error;
  }
}

/**
 * Lift math from paragraphs. All information on the paragraph is copied (e.g. classes)
 *
 * ```
 * [ ..., {paragraph: [child1, math1, child2, child3, math2]}, ... ]
 * [ ..., {paragraph: [child1]}, math1, {paragraph: [child2, child3]}, math2, ... ]
 * ```
 *
 * @param tree
 * @param file
 */
export function mathNestingTransform(
  tree: GenericParent,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  file: VFile,
) {
  // Dollar math can be nested inside of a paragraph
  // This finds those and marks them as `tight` in some way, depending on where they are in the paragraph
  // Directives and AMSMath will never follow this path
  const paragraphs = selectAll('paragraph', tree) as GenericParent[];
  paragraphs.forEach((paragraph) => {
    if (paragraph.children.length === 1) return; // no need to traverse, the math node can never be tight!
    paragraph.children.forEach((child, index) => {
      if (child.type !== 'math') return;
      const math = child as Math;
      const before = paragraph.children[index - 1];
      const after = paragraph.children[index + 1];
      if (index === 0) {
        math.tight = 'after';
      } else if (index === paragraph.children.length - 1) {
        math.tight = 'before';
      } else {
        math.tight = true;
      }
      // Note: There is likely a bug in the dollar-math parser that we are correcting here
      if (before?.type === 'text') {
        before.value = before.value?.replace(/\n$/, '') ?? '';
      }
      if (after?.type === 'text') {
        after.value = after.value?.replace(/^\n/, '') ?? '';
      }
    });
  });
  unnestTransform(tree as GenericParent, 'paragraph', 'math');
}

export function mathLabelTransform(tree: GenericParent, file: VFile) {
  // Subequation members (mathGroup children) are numbered as lettered
  // sub-equations; they do not participate in per-row numbering.
  const subequations = new Set(selectAll('mathGroup > math', tree));
  const nodes = selectAll('math,inlineMath', tree) as (Math | InlineMath)[];
  nodes.forEach((node) => {
    transformMathValue(file, node);
    removeSimpleEquationEnv(file, node);
    if (node.type === 'math' && !subequations.has(node)) {
      extractMathRows(file, node);
    }
    labelMathNodes(file, node);
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function subequationTransform(tree: GenericParent, file: VFile) {
  const nodes = selectAll('mathGroup > math', tree) as Math[];
  nodes.forEach((node) => {
    node.kind = 'subequation';
  });
}

export function mathTransform(tree: GenericParent, file: VFile, opts?: Options) {
  const nodes = selectAll('math,inlineMath', tree) as (Math | InlineMath)[];
  nodes.forEach((node) => {
    renderEquation(file, node, opts);
  });
}

/**
 * Re-render row-numbered math (align/gather/alignat) after enumeration has
 * assigned per-row enumerators, injecting them as explicit `\tag{...}`s so the
 * numbers appear at each row with the alignment axis preserved.
 *
 * The initial `mathTransform` runs before enumeration, so row-numbered nodes
 * are first rendered without numbers; this transform must run after
 * `enumerateTargetsTransform`.
 */
export function renderRowNumberedMathTransform(tree: GenericParent, file: VFile, opts?: Options) {
  const nodes = selectAll('math', tree) as Math[];
  nodes.forEach((node) => {
    if (!node.rows?.rows?.some((row) => row.enumerator && !row.tag)) return;
    renderEquation(file, node, opts);
  });
}

export const mathNestingPlugin: Plugin<[], GenericParent, GenericParent> = () => (tree, file) => {
  mathNestingTransform(tree, file);
};

export const mathLabelPlugin: Plugin<[], GenericParent, GenericParent> = () => (tree, file) => {
  mathLabelTransform(tree, file);
};

export const mathPlugin: Plugin<[Options?], GenericParent, GenericParent> =
  (opts) => (tree, file) => {
    mathTransform(tree, file, opts);
  };
