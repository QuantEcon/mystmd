import type { Block } from '../blocks.js';
import { blockBody, findRoles, proseSegments } from '../blocks.js';
import type { RuleAPI, UpgradeRule } from '../rule.js';
import { codeCells, optionEntries } from './options.js';

const GLUE_IMPORT = /^\s*from\s+myst_nb\s+import\s+glue\s*$/;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A one-line `glue("key", value, …)` call; the third group is what follows the value
 */
function glueCall(key: string) {
  return new RegExp(
    `^\\s*glue\\(\\s*(['"])${escapeRegExp(key)}\\1\\s*,\\s*([^,()]+?)\\s*(?:,\\s*(.*?))?\\s*\\)\\s*$`,
  );
}

type GlueDisplay = { display: boolean } | { error: string };

/**
 * Whether a glue call displays its output, from what follows its value
 */
function glueDisplay(rest: string | undefined): GlueDisplay {
  if (rest === undefined) return { display: true };
  const keyword = /^display\s*=\s*(.*)$/.exec(rest);
  if (!keyword) {
    return { error: `display is given as a positional argument (${rest}), not as display=` };
  }
  if (keyword[1] === 'True') return { display: true };
  if (keyword[1] === 'False') return { display: false };
  return { error: `display=${keyword[1]} is not a literal True or False` };
}

/** A glue call that hides its output */
const HIDDEN_GLUE_CALL = /^\s*glue\(.*\bdisplay\s*=\s*False\s*\)\s*$/;

const REMOVE_OUTPUT = 'remove-output';

/** Statements that print or display something */
const OUTPUT_CALL = /\b(?:print|display)\s*\(|\.show\s*\(/;

/** Lines that start a statement whose value is not displayed */
const STATEMENT =
  /^(?:import|from|def|class|for|while|if|elif|else|try|except|finally|with|return|raise|assert|del|pass|break|continue|global|nonlocal|async)\b|^[@%!]/;

/** An assignment, `a = …`, `a.b[0] += …` or `a: int = …` */
const ASSIGNMENT = /^[\w.,\s[\]'"*()]+?(?::[^=]+)?\s*(?:[-+*/%&|^@]|\*\*|\/\/|>>|<<)?=(?!=)/;

/**
 * Whether a cell has statements, besides the glue call, that may produce
 * output: a `print(...)`, a `display(...)`, a `.show()`, or a bare expression
 * as its last statement, whose value Jupyter displays
 */
function mayProduceOtherOutput(lines: string[], call: number): boolean {
  const statements = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim() && !/^\s*#/.test(line));
  if (statements.some(({ line, index }) => index !== call && OUTPUT_CALL.test(line))) return true;
  const last = [...statements].reverse().find(({ line }) => /^[^\s)\]}]/.test(line));
  if (!last || last.index === call) return false;
  const text = last.line.trim();
  return !(STATEMENT.test(text) || ASSIGNMENT.test(text) || text.endsWith(';'));
}

const ANY_GLUE_CALL = /^\s*glue\(/;

/** The `:label:` of a code cell, as an option line or a `label:` key */
function cellLabel(lines: string[], block: Block): string | undefined {
  const entry = optionEntries(lines, block).find((item) => !item.nested && item.key === 'label');
  return entry?.value.replace(/^(['"])(.*)\1$/, '$2');
}

function unquote(value: string) {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Add `tag` to a list written inline, `[a, b]` or `a, b`
 *
 * @returns the new value, or `undefined` when the tag is already in the list
 */
function addToList(value: string, tag: string): string | undefined {
  const bracketed = /^\[(.*)\]$/.exec(value.trim());
  const items = (bracketed ? bracketed[1] : value)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item);
  if (items.some((item) => unquote(item) === tag)) return undefined;
  const kept = [...items, tag];
  return bracketed ? `[${kept.join(', ')}]` : kept.join(', ');
}

/**
 * Label a code cell, as the first of its options, and add a tag to it
 *
 * Both go in one set of edits, since a rule's edits must not overlap: an
 * existing tag list, as a `:tags:` line or a flow or block list in a `---`
 * block, gets the tag; a cell without tags gets them in its own option form.
 * A tag already there is not added again.
 */
function editCell(
  lines: string[],
  block: Block,
  api: RuleAPI,
  edits: { label?: string; tag?: string; note?: string },
) {
  const { label, tag, note } = edits;
  const yaml = block.options.yaml;
  const anchor = yaml ? block.options.start : block.open;
  const indent = yaml ? /^\s*/.exec(lines[block.options.start + 1] ?? '')![0] : block.indent;
  const prefix = yaml ? '' : ':';
  const inserted: string[] = [];
  if (label) {
    inserted.push(`${indent}${prefix}label: ${label}`);
    api.change(block.open, '', `label: ${label}`);
  }
  if (tag) {
    const entries = optionEntries(lines, block);
    const index = entries.findIndex((entry) => !entry.nested && entry.key === 'tags');
    const entry = entries[index];
    if (!entry) {
      const line = `${indent}${prefix}tags: [${tag}]`;
      inserted.push(line);
      api.change(block.open, '', line.trim(), note);
    } else if (entry.value) {
      const value = addToList(entry.value, tag);
      if (value !== undefined) {
        const before = lines[entry.line];
        const after = `${before.slice(0, before.lastIndexOf(entry.value))}${value}`;
        api.replace(entry.line, entry.line + 1, [after]);
        api.change(entry.line, before, after, note);
      }
    } else {
      // A YAML block list: the items are the nested lines below the key
      const items: number[] = [];
      for (let k = index + 1; k < entries.length && entries[k].nested; k++) {
        if (/^\s*-\s/.test(lines[entries[k].line])) items.push(entries[k].line);
      }
      const tagged = items.some(
        (line) => unquote(lines[line].replace(/^\s*-\s*/, '').trim()) === tag,
      );
      if (!items.length) {
        const before = lines[entry.line];
        const after = `${before.replace(/\s*$/, '')} [${tag}]`;
        api.replace(entry.line, entry.line + 1, [after]);
        api.change(entry.line, before, after, note);
      } else if (!tagged) {
        const last = items[items.length - 1];
        const after = `${/^\s*-\s*/.exec(lines[last])![0]}${tag}`;
        api.replace(last, last + 1, [lines[last], after]);
        api.change(last, '', after, note);
      }
    }
  }
  if (inserted.length) api.replace(anchor, anchor + 1, [lines[anchor], ...inserted]);
}

/**
 * A glued figure becomes a figure that embeds the output of a labelled cell
 *
 * The cell that produced the figure gets a label (its own, or `glue-<key>`),
 * `{glue:figure} key` becomes `{figure} #<label>` with its caption and
 * options, and the `glue(...)` call is removed; so is
 * `from myst_nb import glue` once the page makes no other glue call. A key
 * that is glued nowhere on the page, glued more than once, or used by another
 * glue role or directive fails.
 *
 * When the call has `display=False`, the cell also gets the `remove-output`
 * tag, so that the figure shows once, where the figure places it. A `display`
 * that is not a literal `True` or `False`, or a positional one, fails; so does
 * another glue call in the cell that would display, since the tag would hide
 * it. A cell with other statements that may produce output gets the tag, with
 * a note on the change.
 */
export const glueFigure: UpgradeRule = {
  name: 'glue-figure',
  run(lines, api) {
    const figures = api.doc.blocks.filter((block) => block.name === 'glue:figure');
    if (!figures.length) return;
    const cells = codeCells(api.doc.blocks);
    const labels = new Set(api.context.labels ?? []);
    // Every other use of a glue key on the page: roles and other glue directives
    const otherUses = new Map<string, number>();
    proseSegments(lines, api.doc).forEach((segment) => {
      findRoles(segment.text)
        .filter((role) => role.name === 'glue' || role.name.startsWith('glue:'))
        .forEach((role) => {
          const key = role.content.trim();
          otherUses.set(key, (otherUses.get(key) ?? 0) + 1);
        });
    });
    api.doc.blocks
      .filter((block) => block.name?.startsWith('glue') && block.name !== 'glue:figure')
      .forEach((block) => {
        const key = block.argument.trim();
        otherUses.set(key, (otherUses.get(key) ?? 0) + 1);
      });
    const keyCounts = new Map<string, number>();
    figures.forEach((block) => {
      const key = block.argument.trim();
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    });

    const removed = new Set<number>();
    const labelled = new Set<Block>();
    figures.forEach((block) => {
      const key = block.argument.trim();
      if (!key || keyCounts.get(key)! > 1 || otherUses.has(key)) {
        api.fail(
          block.open,
          `{glue:figure} ${key || '(no key)'}: the key is placed more than once on the page; rewrite it by hand`,
        );
        return;
      }
      const pattern = glueCall(key);
      const calls = cells.flatMap((cell) =>
        blockBody(lines, cell)
          .map((line, offset) => ({ cell, line: cell.bodyStart + offset }))
          .filter(({ line }) => pattern.test(lines[line])),
      );
      if (calls.length !== 1) {
        api.fail(
          block.open,
          calls.length
            ? `{glue:figure} ${key}: the key is glued more than once on the page`
            : `{glue:figure} ${key}: no glue("${key}", …) call on the page`,
        );
        return;
      }
      const [{ cell, line }] = calls;
      const display = glueDisplay(pattern.exec(lines[line])![3]);
      if ('error' in display) {
        api.fail(line, `glue("${key}", …): ${display.error}; rewrite it by hand`);
        return;
      }
      if (labelled.has(cell)) {
        api.fail(block.open, `{glue:figure} ${key}: the cell glues another figure too`);
        return;
      }
      const body = blockBody(lines, cell);
      if (!display.display) {
        // remove-output would also hide what another glue call in the cell displays
        const shown = body
          .map((text, offset) => ({ text, index: cell.bodyStart + offset }))
          .filter(
            ({ text, index }) =>
              index !== line && ANY_GLUE_CALL.test(text) && !HIDDEN_GLUE_CALL.test(text),
          );
        if (shown.length) {
          shown.forEach(({ index }) => {
            api.fail(
              index,
              `{glue:figure} ${key}: this glue call displays its output, which the remove-output tag for the figure would hide; rewrite it by hand`,
            );
          });
          return;
        }
      }
      const existing = cellLabel(lines, cell);
      const label = existing ?? `glue-${key.replace(/[^\w-]/g, '-')}`;
      if (!existing && labels.has(label)) {
        api.fail(block.open, `{glue:figure} ${key}: the label ${label} is already taken`);
        return;
      }
      editCell(lines, cell, api, {
        label: existing ? undefined : label,
        tag: display.display ? undefined : REMOVE_OUTPUT,
        note: mayProduceOtherOutput(body, line - cell.bodyStart)
          ? 'the cell has other statements that may produce output, which remove-output hides too'
          : undefined,
      });
      labelled.add(cell);
      removed.add(line);
      api.change(line, lines[line], '');
      api.replace(line, line + 1, []);
      const before = lines[block.open];
      const after = `${block.indent}${block.marker}{figure} #${label}`;
      api.change(block.open, before, after);
      api.replace(block.open, block.open + 1, [after]);
    });

    if (!removed.size) return;
    // The import goes once nothing on the page calls glue
    const remaining = cells.some((cell) =>
      blockBody(lines, cell).some(
        (line, offset) => !removed.has(cell.bodyStart + offset) && ANY_GLUE_CALL.test(line),
      ),
    );
    if (remaining) return;
    cells.forEach((cell) => {
      blockBody(lines, cell).forEach((line, offset) => {
        if (!GLUE_IMPORT.test(line)) return;
        const index = cell.bodyStart + offset;
        api.change(index, line, '');
        api.replace(index, index + 1, []);
      });
    });
  },
};
