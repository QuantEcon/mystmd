import type { Block } from '../blocks.js';
import { blockBody, findRoles, proseSegments } from '../blocks.js';
import type { RuleAPI, UpgradeRule } from '../rule.js';
import { codeCells, optionEntries } from './options.js';

const GLUE_IMPORT = /^\s*from\s+myst_nb\s+import\s+glue\s*$/;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function glueCall(key: string) {
  return new RegExp(
    `^\\s*glue\\(\\s*(['"])${escapeRegExp(key)}\\1\\s*,\\s*[^,()]+?\\s*(?:,\\s*display\\s*=\\s*(?:False|True)\\s*)?\\)\\s*$`,
  );
}

const ANY_GLUE_CALL = /^\s*glue\(/;

/** The `:label:` of a code cell, as an option line or a `label:` key */
function cellLabel(lines: string[], block: Block): string | undefined {
  const entry = optionEntries(lines, block).find((item) => !item.nested && item.key === 'label');
  return entry?.value.replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Add a label to a code cell, as the first of its options
 */
function labelCell(lines: string[], block: Block, label: string, api: RuleAPI) {
  if (block.options.yaml) {
    const first = block.options.start + 1;
    const indent = /^\s*/.exec(lines[first] ?? '')![0];
    api.replace(block.options.start, block.options.start + 1, [
      lines[block.options.start],
      `${indent}label: ${label}`,
    ]);
  } else {
    api.replace(block.open, block.open + 1, [lines[block.open], `${block.indent}:label: ${label}`]);
  }
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
      if (labelled.has(cell)) {
        api.fail(block.open, `{glue:figure} ${key}: the cell glues another figure too`);
        return;
      }
      let label = cellLabel(lines, cell);
      if (!label) {
        label = `glue-${key.replace(/[^\w-]/g, '-')}`;
        if (labels.has(label)) {
          api.fail(block.open, `{glue:figure} ${key}: the label ${label} is already taken`);
          return;
        }
        labelCell(lines, cell, label, api);
        api.change(cell.open, '', `label: ${label}`);
      }
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
