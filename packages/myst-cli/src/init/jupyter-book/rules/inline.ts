import type { InlineLink, InlineRole } from '../blocks.js';
import { findLinks, findRoles, lineOfOffset, proseSegments } from '../blocks.js';
import type { RuleAPI } from '../rule.js';

type Rewrite = { start: number; end: number; replacement: string };

function applyRewrites(
  lines: string[],
  api: RuleAPI,
  segment: { start: number; end: number; text: string },
  rewrites: Rewrite[],
) {
  if (!rewrites.length) return;
  let text = segment.text;
  for (const { start, end, replacement } of [...rewrites].sort((a, b) => b.start - a.start)) {
    text = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
  }
  rewrites.forEach(({ start, end, replacement }) => {
    api.change(
      segment.start + lineOfOffset(segment.text, start),
      segment.text.slice(start, end),
      replacement,
    );
  });
  api.replace(segment.start, segment.end, text.split('\n'));
}

/**
 * Rewrite roles in the prose of a document: never in code, comments or inline code
 *
 * @param rewrite - returns the replacement for a role, or `undefined` to leave it
 */
export function rewriteRoles(
  lines: string[],
  api: RuleAPI,
  rewrite: (role: InlineRole, line: number) => string | undefined,
) {
  for (const segment of proseSegments(lines, api.doc)) {
    const rewrites: Rewrite[] = [];
    for (const role of findRoles(segment.text)) {
      const line = segment.start + lineOfOffset(segment.text, role.start);
      const replacement = rewrite(role, line);
      if (replacement !== undefined) {
        rewrites.push({ start: role.start, end: role.end, replacement });
      }
    }
    applyRewrites(lines, api, segment, rewrites);
  }
}

/**
 * Rewrite the URL of inline links in the prose of a document
 *
 * @param rewrite - returns the new URL for a link, or `undefined` to leave it
 */
export function rewriteLinkUrls(
  lines: string[],
  api: RuleAPI,
  rewrite: (link: InlineLink, line: number) => string | undefined,
) {
  for (const segment of proseSegments(lines, api.doc)) {
    const rewrites: Rewrite[] = [];
    for (const link of findLinks(segment.text)) {
      const line = segment.start + lineOfOffset(segment.text, link.start);
      const url = rewrite(link, line);
      if (url !== undefined) {
        rewrites.push({
          start: link.urlStart,
          end: link.urlStart + link.url.length,
          replacement: url,
        });
      }
    }
    applyRewrites(lines, api, segment, rewrites);
  }
}

/**
 * Split a role's content written as `text <target>` into its parts
 */
export function explicitTitle(content: string): { text?: string; target: string } {
  const match = /^([\s\S]*?)\s*<([^<>]+)>$/.exec(content);
  if (match && match[1].trim()) {
    return { text: match[1], target: match[2].trim() };
  }
  return { target: content.trim() };
}

/**
 * Escape the brackets in link text, so that the text cannot end the link early
 */
export function escapeLinkText(text: string): string {
  return text.replace(/(?<!\\)([[\]])/g, '\\$1');
}
