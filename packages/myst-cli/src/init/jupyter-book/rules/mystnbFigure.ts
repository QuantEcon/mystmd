import yaml from 'js-yaml';
import type { UpgradeRule } from '../rule.js';
import { excerpt } from '../rule.js';
import { codeCells, optionEntries } from './options.js';

/** Keys the code-cell options cannot carry until QuantEcon/mystmd#114 adds them */
const NEEDS_CODE_CELL_OPTIONS = new Set(['figure.width', 'image.width', 'image.alt']);

function yamlLine(key: string, value: string, indent: string): string[] {
  return yaml
    .dump({ [key]: value }, { lineWidth: -1 })
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => `${indent}${line}`);
}

/**
 * The `mystnb` figure metadata of a code cell becomes its own options:
 * `figure.name` becomes `label` and `figure.caption` becomes `caption`
 *
 * `width` and `alt` have no code-cell option yet (QuantEcon/mystmd#114), and
 * any other key is unknown: either fails, and the cell is left as it was.
 */
export const mystnbFigure: UpgradeRule = {
  name: 'mystnb-figure',
  run(lines, api) {
    codeCells(api.doc.blocks)
      .filter((block) => block.options.yaml)
      .forEach((block) => {
        const entries = optionEntries(lines, block);
        const index = entries.findIndex((entry) => !entry.nested && entry.key === 'mystnb');
        if (index < 0) return;
        const entry = entries[index];
        let end = index + 1;
        while (end < entries.length && entries[end].nested) end++;
        const subtree = entries.slice(index, end).map(({ line }) => lines[line]);
        let mystnb: unknown;
        try {
          mystnb = (yaml.load(subtree.join('\n')) as Record<string, unknown>)?.mystnb;
        } catch (error) {
          api.fail(entry.line, `mystnb metadata is not valid YAML: ${(error as Error).message}`);
          return;
        }
        if (!mystnb || typeof mystnb !== 'object' || Array.isArray(mystnb)) {
          api.fail(entry.line, `mystnb metadata is not a mapping: rewrite it by hand`);
          return;
        }
        const pending: string[] = [];
        const unknown: string[] = [];
        const values: { label?: string; caption?: string } = {};
        Object.entries(mystnb as Record<string, unknown>).forEach(([group, value]) => {
          if ((group !== 'figure' && group !== 'image') || !value || typeof value !== 'object') {
            unknown.push(group);
            return;
          }
          Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
            const path = `${group}.${key}`;
            if (NEEDS_CODE_CELL_OPTIONS.has(path)) {
              pending.push(path);
            } else if (path === 'figure.name' && typeof item === 'string') {
              values.label = item;
            } else if (path === 'figure.caption' && typeof item === 'string') {
              values.caption = item;
            } else {
              unknown.push(path);
            }
          });
        });
        if (pending.length) {
          api.fail(
            entry.line,
            `mystnb ${pending.join(', ')} cannot be converted until the code cell has width and alt options (QuantEcon/mystmd#114)`,
          );
        }
        if (unknown.length) {
          api.fail(entry.line, `mystnb ${unknown.join(', ')} cannot be converted`);
        }
        if (pending.length || unknown.length) return;
        const existing = entries.filter((item) => !item.nested).map((item) => item.key);
        const clash = (['label', 'caption'] as const).filter(
          (key) => values[key] !== undefined && existing.includes(key),
        );
        if (clash.length) {
          api.fail(entry.line, `the cell already has ${clash.join(' and ')}: rewrite it by hand`);
          return;
        }
        const indent = /^\s*/.exec(lines[entry.line])![0];
        const replacement = [
          ...(values.label !== undefined ? yamlLine('label', values.label, indent) : []),
          ...(values.caption !== undefined ? yamlLine('caption', values.caption, indent) : []),
        ];
        const last = entries[end - 1].line;
        api.change(entry.line, excerpt(subtree), excerpt(replacement));
        api.replace(entry.line, last + 1, replacement);
      });
  },
};
