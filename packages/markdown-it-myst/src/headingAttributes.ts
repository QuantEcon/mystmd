import type MarkdownIt from 'markdown-it/lib/index.js';
import type StateCore from 'markdown-it/lib/rules_core/state_core.js';
import { tokenizeInlineAttributes } from './inlineAttributes.js';

/**
 * Trailing attribute block on a heading line, e.g. `## Title {#id .class}`.
 *
 * The block must end the line and be preceded by whitespace (or be the entire
 * content). A backslash-escaped `\{` never matches: the escape character sits
 * where the required whitespace would be.
 */
const HEADING_ATTRS_PATTERN = /(?:^|[ \t])\{([^{}]+)\}[ \t]*$/;

export type HeadingAttributes = {
  enumerated?: boolean;
  label?: string;
  classes?: string[];
};

/**
 * Parse the inside of a heading attribute block into heading fields.
 *
 * Recognized vocabulary (pandoc heading-attribute compatible):
 *   - `#id`          — reference label for the heading (at most one)
 *   - `.class`       — CSS class; `.unnumbered` is consumed as `enumerated: false`
 *   - `-`            — pandoc shorthand for `.unnumbered`
 *   - `enumerated=true|false` — explicit control, `"quoted"` or bare
 *
 * Returns `undefined` when the content is not entirely made of recognized
 * attributes — the caller must then leave the braces as literal text, so
 * prose like `## The set {a, b}` is never destroyed.
 */
export function parseHeadingAttributes(header: string): HeadingAttributes | undefined {
  const tokens = tokenizeInlineAttributes(header.trim());
  if (tokens.length === 0) return undefined;
  const result: HeadingAttributes = {};
  const classes: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'class') {
      if (token.value === 'unnumbered') {
        result.enumerated = false;
      } else {
        classes.push(token.value);
      }
    } else if (token.kind === 'id') {
      // Multiple ids or a leading digit: not a valid attribute block
      if (result.label !== undefined) return undefined;
      if (/^[0-9]/.test(token.value)) return undefined;
      result.label = token.value;
    } else if (token.kind === 'bare' && token.value === '-') {
      result.enumerated = false;
    } else if (
      token.kind === 'attr' &&
      token.key === 'enumerated' &&
      (token.value === 'true' || token.value === 'false')
    ) {
      result.enumerated = token.value === 'true';
    } else {
      return undefined;
    }
  }
  if (classes.length) result.classes = classes;
  return result;
}

function headingAttributesRule(state: StateCore): boolean {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    const inline = tokens[i + 1];
    if (inline.type !== 'inline') continue;
    const match = inline.content.match(HEADING_ATTRS_PATTERN);
    if (!match) continue;
    const attrs = parseHeadingAttributes(match[1]);
    if (!attrs) continue;
    inline.content = inline.content.slice(0, match.index).trimEnd();
    const heading = tokens[i];
    heading.meta = { ...heading.meta };
    if (attrs.enumerated !== undefined) heading.meta.enumerated = attrs.enumerated;
    if (attrs.label) heading.meta.label = attrs.label;
    if (attrs.classes?.length) heading.meta.class = attrs.classes.join(' ');
  }
  return true;
}

/**
 * A markdown-it plugin for pandoc-style attribute blocks on headings.
 *
 * `## Title {#id .class .unnumbered}` attaches `label`, `class`, and
 * `enumerated` to the `heading_open` token's meta and strips the block from
 * the heading text. Runs on the core chain between block and inline parsing,
 * so it applies to ATX and setext headings alike, including inside nested
 * directive content.
 */
export function headingAttributesPlugin(md: MarkdownIt): void {
  md.core.ruler.after('block', 'heading_attributes', headingAttributesRule);
}
