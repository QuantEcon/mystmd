import type { Block } from '../blocks.js';
import { optionLineRange } from '../blocks.js';
import type { RuleAPI } from '../rule.js';

/**
 * The option lines of a block with the key each one sets
 *
 * For a `---` YAML block, only top-level keys are named; a line nested under a
 * key, such as a list item, has no key and belongs to the key above it.
 */
export function optionEntries(lines: string[], block: Block) {
  const { start, end } = optionLineRange(block);
  const entries: { line: number; key?: string; value: string; nested: boolean }[] = [];
  let topIndent: number | undefined;
  for (let k = start; k < end; k++) {
    const line = lines[k];
    if (block.options.yaml) {
      if (!line.trim() || /^\s*#/.test(line)) {
        entries.push({ line: k, value: '', nested: true });
        continue;
      }
      const indent = line.length - line.trimStart().length;
      topIndent = topIndent ?? indent;
      const match = /^\s*([\w-]+):(?:\s+(.*?))?\s*$/.exec(line);
      if (indent === topIndent && match) {
        entries.push({ line: k, key: match[1], value: match[2] ?? '', nested: false });
      } else {
        entries.push({ line: k, value: line.trim(), nested: true });
      }
    } else {
      const match = /^\s*:([\w-]+):(?:\s+(.*?))?\s*$/.exec(line);
      entries.push({ line: k, key: match?.[1], value: match?.[2] ?? '', nested: false });
    }
  }
  return entries;
}

/**
 * Remove and replace option lines of a block
 *
 * When no option is left, the whole option block goes, with its `---`
 * delimiters, and so does the blank line that separated it from the body.
 */
export function editOptionLines(
  lines: string[],
  block: Block,
  api: RuleAPI,
  edits: { remove?: Set<number>; replace?: Map<number, string[]> },
) {
  const remove = edits.remove ?? new Set<number>();
  const replace = edits.replace ?? new Map<number, string[]>();
  const { start, end } = optionLineRange(block);
  let remaining = 0;
  for (let k = start; k < end; k++) {
    if (remove.has(k)) continue;
    const replacement = replace.get(k);
    const kept = replacement ?? [lines[k]];
    remaining += kept.filter((line) => line.trim() && !/^\s*#/.test(line)).length;
  }
  if (remaining === 0) {
    let blockEnd = block.options.end;
    if (blockEnd < block.close && lines[blockEnd].trim() === '') blockEnd += 1;
    api.replace(block.options.start, blockEnd, []);
    return;
  }
  for (let k = start; k < end; k++) {
    if (remove.has(k)) {
      api.replace(k, k + 1, []);
    } else if (replace.has(k)) {
      api.replace(k, k + 1, replace.get(k)!);
    }
  }
}

/**
 * Code cells of a document, the cells the code-cell rules may touch
 */
export function codeCells(blocks: Block[]): Block[] {
  return blocks.filter((block) => block.kind === 'directive' && block.name === 'code-cell');
}
