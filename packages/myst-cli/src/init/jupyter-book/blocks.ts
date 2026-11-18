/**
 * A line-level scanner for the fenced blocks of a MyST document.
 *
 * The upgrade rules rewrite source text, so they need exact line numbers for
 * every construct they touch, including constructs nested in the body of a
 * directive that `mystParse` does not know (an `{only}` or a `{prf:Theorem}`
 * body is not parsed, so nothing inside it has a position). This scanner
 * follows the fence rules instead: a block opens with three or more
 * backticks, tildes or colons and closes with the first bare run of the same
 * character that is at least as long. The bodies of directives are scanned
 * recursively, except for directives whose body is a listing rather than
 * content (a code cell, a code block, a raw block, maths), which are treated
 * as code, as an unnamed fence is.
 */

const FENCE_OPEN = /^(\s*)(`{3,}|:{3,}|~{3,})\s*(?:\{([^}\s]+)\})?\s*(.*?)\s*$/;

const closingFence = (marker: string) => new RegExp(`^\\s*\\${marker[0]}{${marker.length},}\\s*$`);

/** Directives whose body is a listing, not Markdown content */
export const LISTING_DIRECTIVES = new Set([
  'code-cell',
  'code-block',
  'code',
  'sourcecode',
  'literalinclude',
  'math',
  'raw',
  'eval-rst',
  'mermaid',
  'csv-table',
]);

export type Block = {
  /** A named directive, or a code fence (a fence with no `{name}`) */
  kind: 'directive' | 'code';
  /** The directive name, as written */
  name?: string;
  /** The text after the directive name, or the info string of a code fence */
  argument: string;
  indent: string;
  marker: string;
  /** 0-based index of the opening fence line */
  open: number;
  /** 0-based index of the closing fence line */
  close: number;
  /** Lines `[start, end)` of the option block; `yaml` when it is a `---` block (delimiters included) */
  options: { start: number; end: number; yaml: boolean };
  /** 0-based index of the first body line */
  bodyStart: number;
  /** Whether the body is a listing (code) rather than Markdown content */
  listing: boolean;
  parent?: Block;
};

export type ScannedDocument = {
  /** Every terminated block, outermost first, in document order */
  blocks: Block[];
  /** Lines that are not Markdown prose: frontmatter, listing bodies, comments */
  code: boolean[];
  /** Lines that open or close a block */
  fence: boolean[];
  /** 0-based index of the first line after the frontmatter */
  frontmatterEnd: number;
};

function scanOptions(lines: string[], open: number, close: number) {
  let k = open + 1;
  if (k < close && lines[k].trim() === '---') {
    for (let m = k + 1; m < close; m++) {
      if (lines[m].trim() === '---') {
        return { start: k, end: m + 1, yaml: true };
      }
    }
    return { start: k, end: k, yaml: false };
  }
  while (k < close && /^\s*:[\w-]+:/.test(lines[k])) k++;
  return { start: open + 1, end: k, yaml: false };
}

function scanRange(
  lines: string[],
  from: number,
  to: number,
  parent: Block | undefined,
  doc: ScannedDocument,
) {
  let i = from;
  while (i < to) {
    const match = FENCE_OPEN.exec(lines[i]);
    if (!match) {
      i += 1;
      continue;
    }
    const [, indent, marker, name, argument] = match;
    // A backtick fence's info string cannot itself contain a backtick: this is inline code
    if (marker[0] === '`' && argument.includes('`')) {
      i += 1;
      continue;
    }
    const close = closingFence(marker);
    let end = i + 1;
    while (end < to && !close.test(lines[end])) end += 1;
    const isDirective = name !== undefined;
    // An unnamed colon fence is a container, not code
    const listing = isDirective ? LISTING_DIRECTIVES.has(name) : marker[0] !== ':';
    if (end >= to) {
      // Unterminated: a code fence runs to the end of its container, anything else is not a block
      if (listing) {
        for (let k = i + 1; k < to; k++) doc.code[k] = true;
        doc.fence[i] = true;
        return;
      }
      i += 1;
      continue;
    }
    const options = isDirective
      ? scanOptions(lines, i, end)
      : { start: i + 1, end: i + 1, yaml: false };
    const block: Block = {
      kind: isDirective ? 'directive' : 'code',
      name,
      argument,
      indent,
      marker,
      open: i,
      close: end,
      options,
      bodyStart: options.end,
      listing,
      parent,
    };
    doc.blocks.push(block);
    doc.fence[i] = true;
    doc.fence[end] = true;
    if (listing) {
      for (let k = i + 1; k < end; k++) doc.code[k] = true;
    } else {
      if (options.yaml) {
        for (let k = options.start; k < options.end; k++) doc.code[k] = true;
      }
      scanRange(lines, block.bodyStart, end, block, doc);
    }
    i = end + 1;
  }
}

/**
 * Scan a document for its fenced blocks, and classify each line as prose or code
 */
export function scanDocument(lines: string[]): ScannedDocument {
  const doc: ScannedDocument = {
    blocks: [],
    code: lines.map(() => false),
    fence: lines.map(() => false),
    frontmatterEnd: 0,
  };
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end > 0) {
      doc.frontmatterEnd = end + 1;
      for (let k = 0; k <= end; k++) doc.code[k] = true;
    }
  }
  scanRange(lines, doc.frontmatterEnd, lines.length, undefined, doc);
  // MyST comments are not prose either
  lines.forEach((line, index) => {
    if (!doc.code[index] && /^\s*%/.test(line)) doc.code[index] = true;
  });
  return doc;
}

/**
 * The body lines of a block, `[bodyStart, close)`
 */
export function blockBody(lines: string[], block: Block): string[] {
  return lines.slice(block.bodyStart, block.close);
}

/**
 * The option lines of a block, without the `---` delimiters of a YAML block
 */
export function optionLineRange(block: Block): { start: number; end: number } {
  const { start, end, yaml } = block.options;
  return yaml ? { start: start + 1, end: end - 1 } : { start, end };
}

export type Segment = {
  /** 0-based index of the first line */
  start: number;
  /** 0-based index one past the last line */
  end: number;
  text: string;
};

/**
 * Runs of consecutive prose lines: not code, not a fence, not blank.
 *
 * A role or a link cannot span a blank line or a fence, so each segment can be
 * searched on its own.
 */
export function proseSegments(lines: string[], doc: ScannedDocument): Segment[] {
  const segments: Segment[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start >= 0) {
      segments.push({ start, end, text: lines.slice(start, end).join('\n') });
      start = -1;
    }
  };
  lines.forEach((line, index) => {
    const prose = !doc.code[index] && !doc.fence[index] && line.trim() !== '';
    if (prose) {
      if (start < 0) start = index;
    } else {
      flush(index);
    }
  });
  flush(lines.length);
  return segments;
}

export type InlineRole = {
  /** Offset of the opening `{` in the text */
  start: number;
  /** Offset one past the closing backtick */
  end: number;
  name: string;
  content: string;
  /** The role as written */
  raw: string;
};

export type InlineLink = {
  /** Offset of the opening `[` (or `!` of an image) */
  start: number;
  end: number;
  image: boolean;
  text: string;
  url: string;
  /** Offset of the URL in the text */
  urlStart: number;
};

const ROLE_OPEN = /\{([A-Za-z0-9_:.+-]+)\}(`+)/y;

function backtickRun(text: string, i: number) {
  let j = i;
  while (text[j] === '`') j++;
  return j - i;
}

/** Find the next run of exactly `n` backticks at or after `from` */
function closingRun(text: string, from: number, n: number) {
  let i = from;
  while (i < text.length) {
    if (text[i] === '`') {
      const run = backtickRun(text, i);
      if (run === n) return i;
      i += run;
    } else {
      i++;
    }
  }
  return -1;
}

type InlineToken =
  | { type: 'role'; role: InlineRole }
  | { type: 'text'; start: number; end: number };

/**
 * Split text into roles and the stretches between them, stepping over code spans
 */
function tokenize(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let textStart = 0;
  let i = 0;
  const pushText = (end: number) => {
    if (end > textStart) tokens.push({ type: 'text', start: textStart, end });
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '{') {
      ROLE_OPEN.lastIndex = i;
      const match = ROLE_OPEN.exec(text);
      if (match) {
        const ticks = match[2].length;
        const contentStart = i + match[0].length;
        const close = closingRun(text, contentStart, ticks);
        if (close >= 0) {
          pushText(i);
          const end = close + ticks;
          tokens.push({
            type: 'role',
            role: {
              start: i,
              end,
              name: match[1],
              content: text.slice(contentStart, close),
              raw: text.slice(i, end),
            },
          });
          textStart = end;
          i = end;
          continue;
        }
      }
      i++;
      continue;
    }
    if (c === '`') {
      // A code span: everything up to the matching run of backticks is code
      const run = backtickRun(text, i);
      const close = closingRun(text, i + run, run);
      i = close >= 0 ? close + run : i + run;
      continue;
    }
    i++;
  }
  pushText(text.length);
  return tokens;
}

/**
 * Find the roles in a stretch of prose, skipping code spans
 */
export function findRoles(text: string): InlineRole[] {
  return tokenize(text)
    .filter((token): token is { type: 'role'; role: InlineRole } => token.type === 'role')
    .map(({ role }) => role);
}

/**
 * Find inline links `[text](url)` in a stretch of prose, skipping code spans and roles
 *
 * Only the inline form with a URL that has no spaces and no title is found;
 * reference links and autolinks are not links to rewrite.
 */
export function findLinks(text: string): InlineLink[] {
  const links: InlineLink[] = [];
  // Mask code spans and roles so that brackets inside them are not seen
  const chars = text.split('');
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '`') {
      const run = backtickRun(text, i);
      const close = closingRun(text, i + run, run);
      const end = close >= 0 ? close + run : i + run;
      for (let k = i; k < end; k++) chars[k] = ' ';
      i = end;
      continue;
    }
    i++;
  }
  for (const token of tokenize(text)) {
    if (token.type === 'role') {
      for (let k = token.role.start; k < token.role.end; k++) chars[k] = ' ';
    }
  }
  const masked = chars.join('');
  const pattern = /\]\(([^()\s<>]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked))) {
    const close = match.index;
    // Find the matching opening bracket
    let depth = 0;
    let open = -1;
    for (let k = close - 1; k >= 0; k--) {
      if (masked[k] === ']' && masked[k - 1] !== '\\') depth++;
      if (masked[k] === '[' && masked[k - 1] !== '\\') {
        if (depth === 0) {
          open = k;
          break;
        }
        depth--;
      }
    }
    if (open < 0) continue;
    const image = open > 0 && masked[open - 1] === '!';
    links.push({
      start: image ? open - 1 : open,
      end: close + match[0].length,
      image,
      text: text.slice(open + 1, close),
      url: match[1],
      urlStart: close + 2,
    });
  }
  return links;
}

/**
 * The 0-based line, within a segment, of an offset into its text
 */
export function lineOfOffset(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}
