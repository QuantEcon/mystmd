import type { MathRow, MathRows } from 'myst-spec-ext';

/**
 * Environments whose `\\`-delimited rows each take their own equation number
 * in amsmath. `flalign` and `eqnarray` are also row-numbering in LaTeX but are
 * not supported by KaTeX, so they are excluded here (they fail to render today
 * and per-row numbering would not change that).
 */
const ROW_NUMBERING_ENVS = ['align', 'gather', 'alignat'] as const;

type RowEnv = (typeof ROW_NUMBERING_ENVS)[number];

const BEGIN_PATTERN = new RegExp(`^\\\\begin\\{(${ROW_NUMBERING_ENVS.join('|')})(\\*?)\\}`);

/**
 * Read a balanced `{...}` group starting at `index` (which must point at `{`).
 * Returns the group including braces, or undefined if unbalanced.
 */
function readBraceGroup(source: string, index: number): string | undefined {
  if (source[index] !== '{') return undefined;
  let depth = 0;
  for (let i = index; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') {
      i += 1; // skip escaped character
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(index, i + 1);
    }
  }
  return undefined;
}

type RawRow = { tex: string; sep?: string };

/**
 * Split an environment body into rows at `\\` separators that occur at
 * brace/environment nesting depth zero. A `\\` inside `\begin{cases}...\end{cases}`,
 * a matrix environment, or a brace group is part of that construct, not a row
 * boundary. Separators may be `\\`, `\\*`, or carry a spacing argument like `\\[2em]`.
 */
function splitRows(body: string): RawRow[] | undefined {
  const rows: RawRow[] = [];
  let braceDepth = 0;
  let envDepth = 0;
  let rowStart = 0;
  let i = 0;
  while (i < body.length) {
    const char = body[i];
    if (char === '\\') {
      const next = body[i + 1];
      if (next === '\\') {
        if (braceDepth === 0 && envDepth === 0) {
          // Row separator: consume optional `*` and optional `[<len>]`
          let sepEnd = i + 2;
          if (body[sepEnd] === '*') sepEnd += 1;
          if (body[sepEnd] === '[') {
            const close = body.indexOf(']', sepEnd);
            if (close === -1) return undefined; // malformed; bail out
            sepEnd = close + 1;
          }
          rows.push({ tex: body.slice(rowStart, i), sep: body.slice(i, sepEnd) });
          rowStart = sepEnd;
          i = sepEnd;
          continue;
        }
        i += 2;
        continue;
      }
      if (next === '{' || next === '}') {
        i += 2; // escaped brace: does not affect depth
        continue;
      }
      const command = body.slice(i + 1).match(/^[a-zA-Z]+/)?.[0];
      if (command === 'begin' || command === 'end') {
        const group = readBraceGroup(body, i + 1 + command.length);
        if (!group) return undefined; // malformed; bail out
        envDepth += command === 'begin' ? 1 : -1;
        if (envDepth < 0) return undefined; // unbalanced \end
        i += 1 + command.length + group.length;
        continue;
      }
      i += command ? 1 + command.length : 2;
      continue;
    }
    if (char === '{') braceDepth += 1;
    if (char === '}') {
      braceDepth -= 1;
      if (braceDepth < 0) return undefined;
    }
    i += 1;
  }
  if (braceDepth !== 0 || envDepth !== 0) return undefined;
  rows.push({ tex: body.slice(rowStart) });
  // A trailing `\\` leaves a whitespace-only final row; drop it but keep the
  // previous row's separator out of the rebuilt output (it was a trailing
  // separator, not a boundary between rows).
  const last = rows[rows.length - 1];
  if (rows.length > 1 && last.tex.trim() === '') {
    rows.pop();
    delete rows[rows.length - 1].sep;
  }
  return rows;
}

const LABEL_PATTERN = /\\label\{([^}]+)\}/g;
const NONUMBER_PATTERN = /\\(?:nonumber|notag)(?![a-zA-Z])/;
const TAG_START_PATTERN = /\\tag(\*?)\s*(?=\{)/;

/**
 * Find a per-row `\tag{...}` / `\tag*{...}` and read its full balanced brace
 * group — tag content may itself contain groups (e.g. `\tag{\text{A}}`), so a
 * regex capture up to the first `}` would truncate it.
 */
function findTag(tex: string): { tag: string; star: boolean } | undefined {
  const match = tex.match(TAG_START_PATTERN);
  if (!match || match.index == null) return undefined;
  const group = readBraceGroup(tex, match.index + match[0].length);
  if (!group) return undefined;
  return { tag: group.slice(1, -1), star: match[1] === '*' };
}

export type ScannedMathRow = MathRow & {
  /** Raw (un-normalized) `\label{...}` values found in the row. */
  labels?: string[];
};

export type ScannedMathRows = Omit<MathRows, 'rows'> & {
  rows: ScannedMathRow[];
  /** True when at least one `\label{...}` was stripped from a row. */
  labelsStripped: boolean;
};

/**
 * Scan a display-math value for a row-numbering amsmath environment
 * (align/gather/alignat) and extract its per-row structure.
 *
 * Returns undefined if the value is not a single such environment. Rows are
 * returned with `\label{...}` **stripped from the row source** (mirroring the
 * existing behavior of lifting labels out of math values); `\nonumber`,
 * `\notag` and `\tag{...}` are detected but left in place, since KaTeX (>= 0.16)
 * renders them with amsmath semantics.
 */
export function scanMathRows(value: string): ScannedMathRows | undefined {
  const trimmed = value.trim();
  const beginMatch = trimmed.match(BEGIN_PATTERN);
  if (!beginMatch) return undefined;
  const env = beginMatch[1] as RowEnv;
  const starred = beginMatch[2] === '*';
  const endToken = `\\end{${env}${starred ? '*' : ''}}`;
  if (!trimmed.endsWith(endToken)) return undefined;
  let body = trimmed.slice(beginMatch[0].length, trimmed.length - endToken.length);
  let envArg: string | undefined;
  if (env === 'alignat') {
    const afterWhitespace = body.match(/^\s*/)?.[0].length ?? 0;
    envArg = readBraceGroup(body, afterWhitespace);
    if (!envArg) return undefined; // alignat requires an argument
    body = body.slice(afterWhitespace + envArg.length);
  }
  const rawRows = splitRows(body);
  if (!rawRows) return undefined;
  let labelsStripped = false;
  const rows: ScannedMathRow[] = rawRows.map((raw) => {
    const labels = [...raw.tex.matchAll(LABEL_PATTERN)].map((m) => m[1]);
    // Trim each row: re-assembled environments must not contain blank lines,
    // which are hard errors inside amsmath environments in LaTeX
    const tex = (labels.length ? raw.tex.replace(LABEL_PATTERN, '') : raw.tex).trim();
    if (labels.length) labelsStripped = true;
    const tagMatch = findTag(raw.tex);
    const row: ScannedMathRow = {
      tex,
      sep: raw.sep,
      nonumber: NONUMBER_PATTERN.test(raw.tex) || undefined,
      tag: tagMatch?.tag,
      tagStar: tagMatch?.star || undefined,
    };
    if (labels.length) row.labels = labels;
    return row;
  });
  return { env, starred: starred || undefined, envArg, rows, labelsStripped };
}

/**
 * Rebuild the environment source from scanned rows. Used to write the
 * label-stripped value back to the node, to re-render with injected `\tag`s,
 * and to re-emit labels for LaTeX export.
 */
export function buildRowTex(
  info: MathRows,
  opts?: {
    /** Force the starred (unnumbered) form of the environment. */
    starred?: boolean;
    /** Append ` \tag{<enumerator>}` to rows that were assigned an enumerator. */
    injectTags?: boolean;
    /** Re-append ` \label{<label>}` to rows that carry one (for LaTeX export). */
    injectLabels?: boolean;
  },
): string {
  const starred = opts?.starred ?? info.starred;
  const envName = `${info.env}${starred ? '*' : ''}`;
  const body = info.rows
    .map((row, index) => {
      let tex = row.tex;
      if (opts?.injectLabels && row.label) tex = `${tex} \\label{${row.label}}`;
      if (opts?.injectTags && row.enumerator && !row.tag && !row.nonumber) {
        tex = `${tex} \\tag{${row.enumerator}}`;
      }
      const sep = index < info.rows.length - 1 ? (row.sep ?? '\\\\') : '';
      return `${tex}${sep ? ` ${sep}` : ''}`;
    })
    .join('\n');
  return `\\begin{${envName}}${info.envArg ?? ''}\n${body}\n\\end{${envName}}`;
}
