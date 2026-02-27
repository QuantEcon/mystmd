/**
 * Image attachment embedding for ipynb export.
 *
 * Converts markdown image references `![alt](url)` into Jupyter cell
 * attachments `![alt](attachment:name)` with base64-encoded image data
 * stored in the cell's `attachments` field.
 *
 * This enables self-contained notebooks that don't depend on external
 * image files — useful for distribution, Colab uploads, etc.
 *
 * Architecture (two-phase hybrid):
 *
 *   Phase 1 — AST-driven collection (myst-cli, build/ipynb/index.ts):
 *     `collectImageData()` walks AST image nodes via `selectAll('image', mdast)`,
 *     resolves filesystem paths, reads files, and base64-encodes them into a
 *     `Record<url, ImageData>` map passed to `writeIpynb` as `options.imageData`.
 *
 *   Phase 2 — Post-serialization rewriting (this module):
 *     `embedImagesAsAttachments()` runs AFTER `writeMd` has serialized the AST
 *     to a markdown string. It regex-matches `![alt](url)` patterns, looks up
 *     URLs in the `imageData` map, and rewrites them to `![alt](attachment:name)`.
 *
 * Why regex instead of AST rewriting?
 *   By the time we build cell attachments, `writeMd` has already consumed the AST
 *   and produced a markdown string. Rewriting at the AST level would require the
 *   transform phase to return per-cell attachment metadata alongside the tree,
 *   coupling the pure AST transform to notebook cell structure. The current split
 *   keeps `myst-to-ipynb` (pure, no filesystem) separate from `myst-cli`
 *   (filesystem-aware).
 */

import type { ImageData } from './types.js';

/**
 * Extract the basename (filename) from a URL or path.
 */
function basename(url: string): string {
  // Strip query string and fragment
  const clean = url.split('?')[0].split('#')[0];
  const parts = clean.split('/');
  return parts[parts.length - 1] || 'image';
}

/**
 * Scan markdown text for image references, replace matching URLs with
 * `attachment:<name>` references, and build the cell attachments object.
 *
 * @param md - The markdown string to process
 * @param imageData - Map of image URL → { mime, data } with base64-encoded content
 * @returns Object with rewritten markdown and optional attachments dict
 */
export function embedImagesAsAttachments(
  md: string,
  imageData: Record<string, ImageData>,
): { md: string; attachments?: Record<string, Record<string, string>> } {
  if (!imageData || Object.keys(imageData).length === 0) return { md };

  const attachments: Record<string, Record<string, string>> = {};
  const usedNames = new Set<string>();

  // Match markdown image syntax: ![alt](url) and ![alt](url "title")
  // Handles escaped brackets in alt text and escaped parentheses in URLs.
  // The escaped sequences (\] and \)) must appear BEFORE the single-char
  // alternatives so the regex engine matches them as pairs first.
  const imgRegex = /!\[((?:\\\]|[^\]])*)\]\(((?:\\\)|[^)\s])+)(?:\s+"[^"]*")?\)/g;

  const updatedMd = md.replace(imgRegex, (fullMatch, alt, url) => {
    // Unescape markdown characters that mdast-util-to-markdown might have added
    const unescapedUrl = url.replace(/\\([()[\]])/g, '$1');

    const data = imageData[unescapedUrl];
    if (!data) return fullMatch;

    // Generate a unique attachment name from the basename
    const base = basename(unescapedUrl);
    let name = base;
    let counter = 1;
    while (usedNames.has(name)) {
      const dot = base.lastIndexOf('.');
      if (dot >= 0) {
        name = `${base.slice(0, dot)}_${counter}${base.slice(dot)}`;
      } else {
        name = `${base}_${counter}`;
      }
      counter++;
    }
    usedNames.add(name);

    attachments[name] = { [data.mime]: data.data };
    return `![${alt}](attachment:${name})`;
  });

  if (Object.keys(attachments).length > 0) {
    return { md: updatedMd, attachments };
  }
  return { md };
}
