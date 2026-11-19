import { scanDocument } from '../blocks.js';

const TARGET = /^\s*\(([^()\s]+)\)=\s*$/;
const LABEL_OPTION = /^\s*:(?:label|name):\s*(.+?)\s*$/;
const LABEL_KEY = /^\s*(?:label|name):\s*(.+?)\s*$/;
const MATH_LABEL = /\$\$\s*\(([^()\s]+)\)\s*$/;

function unquote(value: string) {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Every target label a document defines
 *
 * Targets (`(label)=`), the `label` and `name` options of directives (as
 * option lines or in a `---` YAML block, where a `mystnb` figure keeps its
 * name) and the label after display maths (`$$ (label)`).
 */
export function collectLabels(lines: string[]): string[] {
  const doc = scanDocument(lines);
  const labels = new Set<string>();
  lines.forEach((line, index) => {
    if (doc.code[index] || doc.fence[index]) return;
    const target = TARGET.exec(line) ?? MATH_LABEL.exec(line);
    if (target) labels.add(target[1]);
  });
  doc.blocks.forEach((block) => {
    for (let k = block.options.start; k < block.options.end; k++) {
      const match = (block.options.yaml ? LABEL_KEY : LABEL_OPTION).exec(lines[k]);
      if (match) labels.add(unquote(match[1]));
    }
  });
  return [...labels];
}
