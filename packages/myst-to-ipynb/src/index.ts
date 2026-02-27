import type { Root, Node } from 'myst-spec';
import type { Block, Code } from 'myst-spec-ext';
import type { Plugin } from 'unified';
import type { VFile } from 'vfile';
import type { GenericNode } from 'myst-common';
import type { PageFrontmatter } from 'myst-frontmatter';
import { writeMd } from 'myst-to-md';
import { select } from 'unist-util-select';
import { transformToCommonMark } from './commonmark.js';
import type { CommonMarkOptions } from './commonmark.js';
import { embedImagesAsAttachments } from './attachments.js';
export type { ImageData } from './types.js';
import type { ImageData } from './types.js';

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
  return md.replace(/^\+\+\+[^\n]*(\n|$)/gm, '');
}

export interface IpynbOptions {
  /** Markdown format: 'myst' preserves MyST syntax, 'commonmark' converts to plain CommonMark */
  markdown?: 'myst' | 'commonmark';
  /** Options for CommonMark conversion */
  commonmark?: CommonMarkOptions;
  /**
   * How to handle images: 'reference' keeps URL references (default),
   * 'attachment' embeds as base64 cell attachments for self-contained notebooks.
   *
   * When 'attachment', image data is read from disk by `collectImageData()`
   * in myst-cli (Phase 1), then post-serialization regex rewriting in
   * `embedImagesAsAttachments()` converts `![alt](url)` → `![alt](attachment:name)`
   * and adds the `attachments` field to each cell (Phase 2).
   */
  images?: 'reference' | 'attachment';
  /**
   * Map of image URL → { mime, data } for attachment embedding.
   * Only used when `images` is 'attachment'. Populated by `collectImageData()`
   * in myst-cli which walks AST image nodes and reads files from disk.
   * Keys must match the image URLs as they appear in the serialized markdown
   * (e.g. '/_static/img/foo.png').
   */
  imageData?: Record<string, ImageData>;
}

/**
 * Check whether a node is a code-cell block (i.e. a `{code-cell}` directive
 * that should become a notebook code cell).
 */
function isCodeCellBlock(node: GenericNode): boolean {
  return node.type === 'block' && node.kind === 'notebook-code';
}

/**
 * Check whether a node is an exercise or solution that contains code-cell blocks.
 */
function isGatedNodeWithCodeCells(node: GenericNode, opts?: CommonMarkOptions): boolean {
  if (node.type !== 'exercise' && node.type !== 'solution') return false;
  // Skip solutions that should be dropped — leave intact for transformToCommonMark
  if (node.type === 'solution' && opts?.dropSolutions) return false;
  return node.children?.some(isCodeCellBlock) ?? false;
}

/**
 * Lift code-cell blocks out of exercise/solution nodes that used gated syntax.
 *
 * When gated syntax (`{exercise-start}`/`{exercise-end}`) is used, the
 * `joinGatesTransform` nests all content between the gates — including
 * `{code-cell}` blocks — as children of the exercise/solution node. Then
 * `blockNestingTransform` groups the exercise/solution with neighboring
 * non-block siblings into a single wrapper block. The real AST structure is:
 *
 *   root > block { para, exercise { para, block{code} }, solution { ... }, para }
 *
 * This means code-cell blocks inside exercise/solution never appear as
 * top-level notebook cells; they are absorbed into a single markdown cell.
 *
 * This function walks each block's children, finds exercise/solution nodes
 * that contain code-cell blocks, and splits the block so code cells are
 * emitted as top-level notebook code cells:
 *
 *   BEFORE: block { para, solution { title, para, block{code}, para } }
 *   AFTER:  block { para, solution { title, para } }
 *           block{code}
 *           block { para }
 *
 * When `dropSolutions` is true, solution nodes are left intact so that
 * `transformToCommonMark` can drop them entirely (including their code cells).
 */
function liftCodeCellsFromGatedNodes(root: Root, opts?: CommonMarkOptions): Root {
  const newChildren: Node[] = [];
  let modified = false;

  for (const child of root.children) {
    const c = child as GenericNode;

    // Case 1: exercise/solution directly as root child (e.g. in tests)
    if (isGatedNodeWithCodeCells(c, opts)) {
      modified = true;
      liftFromExerciseSolution(c, newChildren, false);
      continue;
    }

    // Case 2: block containing exercise/solution among its children
    if (
      c.type === 'block' &&
      c.children?.some((ch: GenericNode) => isGatedNodeWithCodeCells(ch, opts))
    ) {
      modified = true;
      splitBlockWithGatedNodes(c, newChildren, opts);
      continue;
    }

    // No gated nodes — keep as-is
    newChildren.push(child);
  }

  if (!modified) return root;
  return { ...root, children: newChildren } as Root;
}

/**
 * Split a single exercise/solution node's children into alternating
 * markdown content and top-level code cells.
 *
 * The first group of markdown content retains the exercise/solution wrapper
 * (for title/enumerator rendering). Subsequent groups become plain content.
 *
 * @param wrapInBlock If true, wraps output groups in block nodes.
 */
function liftFromExerciseSolution(node: GenericNode, output: Node[], wrapInBlock: boolean): void {
  const mdContent: GenericNode[] = [];
  let isFirstGroup = true;

  const flushMarkdown = () => {
    if (mdContent.length === 0) return;
    const content = [...mdContent];
    mdContent.length = 0;

    if (isFirstGroup) {
      // Preserve the exercise/solution wrapper for title rendering
      const wrapper: GenericNode = { ...node, children: content };
      if (wrapInBlock) {
        output.push({ type: 'block', children: [wrapper] } as unknown as Node);
      } else {
        output.push(wrapper as unknown as Node);
      }
      isFirstGroup = false;
    } else {
      if (wrapInBlock) {
        output.push({ type: 'block', children: content } as unknown as Node);
      } else {
        for (const n of content) {
          output.push(n as unknown as Node);
        }
      }
    }
  };

  for (const gatedChild of node.children ?? []) {
    if (isCodeCellBlock(gatedChild)) {
      flushMarkdown();
      output.push(gatedChild as unknown as Node);
    } else {
      mdContent.push(gatedChild);
    }
  }
  flushMarkdown();
}

/**
 * Process a block that contains one or more exercise/solution nodes with
 * embedded code cells, along with other child nodes. Splits the block into
 * multiple top-level blocks and code cells as needed.
 *
 * For non-exercise/solution children, they accumulate in a markdown block.
 * When an exercise/solution with code cells is encountered, the accumulated
 * block is flushed, then the exercise/solution is expanded via
 * liftFromExerciseSolution.
 */
function splitBlockWithGatedNodes(
  block: GenericNode,
  output: Node[],
  opts?: CommonMarkOptions,
): void {
  const pending: GenericNode[] = [];

  const flushPending = () => {
    if (pending.length === 0) return;
    output.push({ type: 'block', children: [...pending] } as unknown as Node);
    pending.length = 0;
  };

  for (const child of block.children ?? []) {
    if (isGatedNodeWithCodeCells(child, opts)) {
      flushPending();
      liftFromExerciseSolution(child, output, true);
    } else {
      pending.push(child);
    }
  }
  flushPending();
}

export function writeIpynb(
  file: VFile,
  node: Root,
  frontmatter?: PageFrontmatter,
  options?: IpynbOptions,
) {
  const markdownFormat = options?.markdown ?? 'myst';

  // Lift code-cell blocks out of gated exercise/solution nodes
  // so they become proper notebook code cells instead of being
  // absorbed into markdown cells.
  node = liftCodeCellsFromGatedNodes(node, options?.commonmark);

  const cells = (node.children as Block[])
    .map((block: Block) => {
      if (block.type === 'block' && block.kind === 'notebook-code') {
        const code = select('code', block) as Code;
        return {
          cell_type: 'code' as const,
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
      // Embed images as cell attachments if requested
      if (options?.images === 'attachment' && options?.imageData) {
        const { md: attachedMd, attachments } = embedImagesAsAttachments(
          cleanMd,
          options.imageData,
        );
        const cell: Record<string, any> = {
          cell_type: 'markdown' as const,
          metadata: {},
          source: sourceToStringList(attachedMd),
        };
        if (attachments) {
          cell.attachments = attachments;
        }
        return cell;
      }
      return {
        cell_type: 'markdown' as const,
        metadata: {},
        source: sourceToStringList(cleanMd),
      };
    })
    .filter((cell) => {
      // Remove empty markdown cells (e.g., from dropped mystTarget/comment nodes)
      if (cell.cell_type === 'markdown') {
        const content = cell.source.join('').trim();
        return content.length > 0;
      }
      return true;
    });

  // Build notebook metadata from frontmatter kernelspec when available
  const languageName =
    frontmatter?.kernelspec?.language ?? frontmatter?.kernelspec?.name ?? 'python';
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
export { embedImagesAsAttachments } from './attachments.js';
