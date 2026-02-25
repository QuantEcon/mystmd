import type { Root } from 'myst-spec';
import type { Block, Code } from 'myst-spec-ext';
import type { Plugin } from 'unified';
import type { VFile } from 'vfile';
import type { PageFrontmatter } from 'myst-frontmatter';
import { writeMd } from 'myst-to-md';
import { select } from 'unist-util-select';
import { transformToCommonMark } from './commonmark.js';
import type { CommonMarkOptions } from './commonmark.js';

function sourceToStringList(src: string): string[] {
  const lines = src.split('\n').map((s) => `${s}\n`);
  lines[lines.length - 1] = lines[lines.length - 1].trimEnd();
  return lines;
}

/**
 * Strip leading `+++` cell break markers from markdown content.
 * These are MyST-specific block separators that have no meaning in notebooks.
 */
function stripBlockMarkers(md: string): string {
  return md.replace(/^\+\+\+[^\n]*\n/, '');
}

export interface IpynbOptions {
  /** Markdown format: 'myst' preserves MyST syntax, 'commonmark' converts to plain CommonMark */
  markdown?: 'myst' | 'commonmark';
  /** Options for CommonMark conversion */
  commonmark?: CommonMarkOptions;
}

export function writeIpynb(
  file: VFile,
  node: Root,
  frontmatter?: PageFrontmatter,
  options?: IpynbOptions,
) {
  const markdownFormat = options?.markdown ?? 'myst';

  const cells = (node.children as Block[]).map((block: Block) => {
    if (block.type === 'block' && block.kind === 'notebook-code') {
      const code = select('code', block) as Code;
      return {
        cell_type: 'code',
        execution_count: null,
        metadata: {},
        outputs: [],
        source: sourceToStringList(code.value),
      };
    }
    // Build the sub-tree for this markdown cell
    let blockTree: any = { type: 'root', children: [block] };
    if (markdownFormat === 'commonmark') {
      blockTree = transformToCommonMark(
        JSON.parse(JSON.stringify(blockTree)),
        options?.commonmark,
      );
    }
    const md = writeMd(file, blockTree).result as string;
    const cleanMd = stripBlockMarkers(md);
    return {
      cell_type: 'markdown',
      metadata: {},
      source: sourceToStringList(cleanMd),
    };
  });

  // Build notebook metadata from frontmatter kernelspec when available
  const languageName = frontmatter?.kernelspec?.language ?? frontmatter?.kernelspec?.name ?? 'python';
  const metadata: Record<string, any> = {
    language_info: {
      name: languageName,
    },
  };
  if (frontmatter?.kernelspec) {
    metadata.kernelspec = {
      name: frontmatter.kernelspec.name,
      display_name: frontmatter.kernelspec.display_name,
      language: languageName,
    };
  }

  const ipynb = {
    cells,
    metadata,
    nbformat: 4,
    nbformat_minor: 2,
  };

  file.result = JSON.stringify(ipynb, null, 2);
  return file;
}

const plugin: Plugin<[PageFrontmatter?, IpynbOptions?], Root, VFile> = function (
  frontmatter?,
  options?,
) {
  this.Compiler = (node, file) => {
    return writeIpynb(file, node, frontmatter, options);
  };

  return (node: Root) => {
    // Preprocess
    return node;
  };
};

export default plugin;
export type { CommonMarkOptions } from './commonmark.js';
