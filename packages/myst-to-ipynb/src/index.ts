import type { Root } from 'myst-spec';
import type { Block, Code } from 'myst-spec-ext';
import type { Plugin } from 'unified';
import type { VFile } from 'vfile';
import type { PageFrontmatter } from 'myst-frontmatter';
import { writeMd } from 'myst-to-md';
import { select } from 'unist-util-select';
import { transformToCommonMark } from './commonmark.js';
import type { CommonMarkOptions } from './commonmark.js';
import { embedImagesAsAttachments } from './attachments.js';

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
  return md.replace(/^\+\+\+[^\n]*\n/gm, '');
}

/** Image data for embedding as cell attachments */
export interface ImageData {
  /** MIME type (e.g. 'image/png') */
  mime: string;
  /** Base64-encoded image data */
  data: string;
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

export function writeIpynb(
  file: VFile,
  node: Root,
  frontmatter?: PageFrontmatter,
  options?: IpynbOptions,
) {
  const markdownFormat = options?.markdown ?? 'myst';

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
