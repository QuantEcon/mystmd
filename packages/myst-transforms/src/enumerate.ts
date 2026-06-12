import type { Plugin } from 'unified';
import { VFile } from 'vfile';
import type { CrossReference, Paragraph } from 'myst-spec';
import type {
  Cite,
  Container,
  Heading,
  Math as MathNode,
  MathGroup,
  Link,
  IndexEntry,
} from 'myst-spec-ext';
import type { PhrasingContent } from 'mdast';
import { visit } from 'unist-util-visit';
import { select, selectAll } from 'unist-util-select';
import { findAndReplace } from 'mdast-util-find-and-replace';
import type { GenericNode, GenericParent } from 'myst-common';
import {
  createHtmlId,
  fileWarn,
  normalizeLabel,
  setTextAsChild,
  copyNode,
  liftChildren,
  TargetKind,
  RuleId,
  isTargetIdentifierNode,
  toText,
  fileError,
} from 'myst-common';
import type { LinkTransformer } from './links/types.js';
import { updateLinkTextIfEmpty } from './links/utils.js';
import { fillNumbering, scopeAliasToDepth } from 'myst-frontmatter';
import type { CounterFormat, PageFrontmatter, Numbering } from 'myst-frontmatter';

const TRANSFORM_NAME = 'myst-transforms:enumerate';

/**
 * Kinds that get the chapter/appendix enumerator prepended when the page is
 * inside a book section (§3.4(6)). Each kind keeps its own counter; only the
 * leading prefix changes per-page. Authors opt out per-kind via
 * `numbering.<kind>.continue: true` (§3.4(7)), which both keeps the counter
 * flat across pages and drops the prefix.
 *
 * Proof family kinds (`proof:theorem`, `proof:lemma`, …) are matched by
 * prefix so adding a new proof kind upstream doesn't require touching this
 * list.
 */
const AUTO_PREFIX_KINDS = new Set<string>([
  'figure',
  'subfigure',
  'equation',
  'subequation',
  'table',
  'exercise',
  'code',
]);

/**
 * Pure kind matcher — does this kind belong to the family that gets the
 * chapter/appendix prefix when book mode is on? The caller also checks
 * `numbering.book.enabled`, `numbering[kind].continue`, and the
 * page-side enumerator before applying the prefix.
 */
function shouldAutoPrefix(kind: string): boolean {
  if (AUTO_PREFIX_KINDS.has(kind)) return true;
  // Cover both the `proof` directive (`type: proof`) and the legacy
  // `prf:*` naming so future renames don't break book mode.
  if (kind.startsWith('proof:') || kind.startsWith('prf:')) return true;
  if (kind === 'proof') return true;
  return false;
}

/**
 * Is this kind part of the proof family (for umbrella scope resolution)?
 * Used so `numbering.proof.scope` applies to every `proof:*` / `prf:*` kind.
 */
function isProofFamilyKind(kind: string): boolean {
  return kind === 'proof' || kind.startsWith('proof:') || kind.startsWith('prf:');
}

/**
 * Build the resolved-kind alias map for `counter:` sharing (#34, LaTeX
 * `\newtheorem{name}[other]{Heading}` parity).
 *
 * Reads every `numbering[kind].counter` value, normalizes it to the
 * fully-qualified form (already done by the frontmatter validator but
 * tolerated here for defensiveness), and computes the *transitive*
 * resolution so chains like `a→b→c` flatten to `a→c`, `b→c`. Cycles are
 * detected and broken: the offending edges are dropped (no alias) and a
 * warning is emitted, so output remains deterministic rather than
 * oscillating between the cycle members.
 *
 * Constraints enforced here, not in the validator:
 *  - **Family check**: aliasing is only honored within the proof family
 *    (`proof:*` / `prf:*`). Cross-family targets are dropped + warned.
 *    The validator can't easily distinguish runtime directive families
 *    from generic kind names, but this engine already has
 *    `isProofFamilyKind` colocated with the rest of the family logic.
 *  - **Cycle break**: `a→b→a` drops both edges (returning self-resolution
 *    for both kinds), rather than picking an arbitrary member as the
 *    slot owner.
 *
 * Kinds without an alias are absent from the returned map; callers
 * default to the kind itself (see `effectiveCounterKind`). The map is
 * built once per `ReferenceState` and reused across every
 * `incrementCount` call — there is no recursive lookup in the hot path.
 */
function buildResolvedCounterMap(numbering: Numbering, vfile?: VFile): Record<string, string> {
  const rawAliases: Record<string, string> = {};
  for (const [kind, item] of Object.entries(numbering)) {
    if (!item?.counter) continue;
    if (!isProofFamilyKind(kind)) {
      if (vfile) {
        fileWarn(
          vfile,
          `numbering.${kind}.counter is only supported for proof-family kinds (proof:*, prf:*); ignoring`,
          { source: TRANSFORM_NAME, ruleId: RuleId.validPageFrontmatter },
        );
      }
      continue;
    }
    const target = item.counter.includes(':') ? item.counter : `proof:${item.counter}`;
    if (!isProofFamilyKind(target)) {
      if (vfile) {
        fileWarn(
          vfile,
          `numbering.${kind}.counter target "${item.counter}" must be a proof-family kind; ignoring`,
          { source: TRANSFORM_NAME, ruleId: RuleId.validPageFrontmatter },
        );
      }
      continue;
    }
    rawAliases[kind] = target;
  }
  const resolved: Record<string, string> = {};
  for (const start of Object.keys(rawAliases)) {
    const path: string[] = [start];
    let cur: string = rawAliases[start];
    let cycled = false;
    while (rawAliases[cur]) {
      if (path.includes(cur)) {
        cycled = true;
        if (vfile) {
          fileWarn(
            vfile,
            `numbering.counter cycle detected: ${[...path, cur].join(' → ')}; aliasing ignored on this chain`,
            { source: TRANSFORM_NAME, ruleId: RuleId.validPageFrontmatter },
          );
        }
        break;
      }
      path.push(cur);
      cur = rawAliases[cur];
    }
    if (cycled) continue; // self-resolution (no alias) for cycle members
    if (cur !== start) resolved[start] = cur;
  }
  return resolved;
}

/**
 * Look up the counter slot that `kind` actually steps. Defaults to the
 * kind itself when no alias is configured — the common case.
 */
function effectiveCounterKind(resolved: Record<string, string>, kind: string): string {
  return resolved[kind] ?? kind;
}

/**
 * Resolve a kind's effective auto-prefix scope depth (#27).
 *
 * Lookup order, most-specific first:
 *  1. `numbering[kind].scope`                — e.g. `numbering['proof:theorem'].scope`
 *  2. `numbering.proof.scope`                — umbrella default for proof family
 *  3. `numbering.all.scope`                  — project-wide default
 *  4. `chapter` (depth 1)                    — current MyST behaviour
 *
 * Returns the heading depth (1 = chapter / heading_1, 2 = section /
 * heading_2, …).
 */
function effectiveScopeDepth(numbering: Numbering, kind: string): number {
  const candidates = [numbering[kind]?.scope];
  if (isProofFamilyKind(kind)) candidates.push(numbering.proof?.scope);
  candidates.push(numbering.all?.scope);
  for (const scope of candidates) {
    if (!scope) continue;
    const depth = scopeAliasToDepth(scope);
    if (depth) return depth;
  }
  return 1;
}

/**
 * Format a heading-prefix string at a fixed scope depth, preserving zero
 * counts (matches LaTeX `\thechapter.\thesection.…` literal output).
 *
 * Unlike `formatHeadingEnumerator`, this does NOT strip trailing zeros —
 * so a section-scoped proof appearing before the first `## Section` in
 * chapter 5 renders as `5.0.1`, not `5.1`. The literal form avoids
 * ambiguity with later `5.1.x` numbers and matches the PDF.
 */
function formatHeadingPrefix(
  counts: (number | null)[],
  scopeDepth: number,
  formats?: (CounterFormat | undefined)[],
): string {
  const parts: string[] = [];
  for (let i = 0; i < scopeDepth; i++) {
    const count = counts[i];
    if (count === null) continue;
    parts.push(formatCounter(count ?? 0, formats?.[i]));
  }
  return parts.join('.');
}

const DEFAULT_NUMBERING: Numbering = {
  equation: { enabled: true, template: '(%s)' },
  subequation: { enabled: true, template: '(%s)' },
  figure: { enabled: true, template: 'Figure %s' },
  subfigure: { enabled: true, template: 'Figure %s' },
  table: { enabled: true, template: 'Table %s' },
  code: { enabled: true, template: 'Program %s' },
  heading_1: { template: 'Section %s' },
  heading_2: { template: 'Section %s' },
  heading_3: { template: 'Section %s' },
  heading_4: { template: 'Section %s' },
  heading_5: { template: 'Section %s' },
  heading_6: { template: 'Section %s' },
};

type ResolvableCrossReference = Omit<CrossReference, 'kind'> & {
  kind?: TargetKind | string;
  enumerator?: string;
  template?: string;
  resolved?: boolean;
  // If the cross reference is remote, then it will have a URL attached
  // This URL should be able to lookup the content; dataUrl is a direct link to structured mdast source data
  remote?: boolean;
  url?: string;
  dataUrl?: string;
  html_id?: string;
};

function getDefaultNumberedReferenceTemplate(kind: TargetKind | string) {
  if (kind === 'code') kind = 'program';
  const domain = kind.includes(':') ? kind.split(':')[1] : kind;
  // eslint-disable-next-line no-irregular-whitespace
  return `${domain.slice(0, 1).toUpperCase()}${domain.slice(1)} %s`;
}

function getDefaultNamedReferenceTemplate(
  kind: TargetKind | string = 'unknown',
  hasTitle: boolean,
) {
  const domain = kind.includes(':') ? kind.split(':')[1] : kind;
  const name = `${domain.slice(0, 1).toUpperCase()}${domain.slice(1)}`;
  switch (kind) {
    // TODO: These need to be moved to the directive definition in an extension
    case 'proof':
    case 'exercise':
      return hasTitle ? `${name} ({name})` : name;
    default:
      if (hasTitle) return '{name}';
      return name;
  }
}

function getReferenceTemplate(
  target: Target,
  numbering: Numbering,
  numbered: boolean,
  hasTitle: boolean,
  offset?: number,
) {
  const { kind, node } = target;
  let template: string | undefined;
  if (numbered) {
    if (kind === TargetKind.heading && node.type === 'heading') {
      // §3.2(h): for heading-type targets, `label` takes precedence over
      // `template`. This is what makes `[](#ch1)` render "Chapter 1" rather
      // than "Section 1" when a project sets `numbering.heading_1.label`.
      const item =
        numbering[`heading_${node.depth - (numbering?.title?.enabled ? 0 : 1) + (offset ?? 0)}`];
      template = item?.label ?? item?.template;
    } else if (node.subcontainer) {
      template = numbering.subfigure?.template;
    } else {
      template = numbering[kind]?.template;
    }
    return template ?? getDefaultNumberedReferenceTemplate(kind);
  }
  return getDefaultNamedReferenceTemplate(kind, hasTitle);
}

export enum ReferenceKind {
  ref = 'ref',
  numref = 'numref',
  eq = 'eq',
}

type TargetNodes = (Container | MathNode | MathGroup | Heading) & {
  html_id: string;
  subcontainer?: boolean;
  parentEnumerator?: string;
  indexEntries?: IndexEntry[];
};

export type Target = {
  node: TargetNodes;
  kind: TargetKind | string;
};

export type TargetCounts = {
  heading: (number | null)[];
} & Record<string, { main: number; sub: number }>;

export type StateOptions = {
  state: ReferenceState;
  hidden?: boolean;
};

export type StateResolverOptions = {
  state: IReferenceStateResolver;
  transformers?: LinkTransformer[];
};

const UNKNOWN_REFERENCE_ENUMERATOR = '??';

/**
 * See https://www.sphinx-doc.org/en/master/usage/restructuredtext/roles.html#role-numref
 */
function fillReferenceEnumerators(
  file: VFile | undefined,
  node: Pick<
    ResolvableCrossReference,
    'label' | 'identifier' | 'children' | 'template' | 'enumerator'
  > & { type: string },
  template: string,
  target?: TargetNodes,
  title?: string | PhrasingContent[],
) {
  const noNodeChildren = !node.children?.length;
  if (noNodeChildren) {
    setTextAsChild(node, template);
  }
  const num =
    target?.enumerator != null
      ? `${target.parentEnumerator ?? ''}${target.enumerator}`
      : UNKNOWN_REFERENCE_ENUMERATOR;
  if (!node.template) node.template = template;
  if (num && num !== UNKNOWN_REFERENCE_ENUMERATOR) node.enumerator = num;
  const used = {
    s: false,
    number: false,
    name: false,
  };
  findAndReplace(node as any, {
    '%s': () => {
      used.s = true;
      return num;
    },
    '{subEnumerator}': () => {
      used.number = true;
      return target?.enumerator ?? UNKNOWN_REFERENCE_ENUMERATOR;
    },
    '{number}': () => {
      used.number = true;
      return num;
    },
    '{name}': () => {
      used.name = true;
      return title || node.label || node.identifier;
    },
  });
  if (num === UNKNOWN_REFERENCE_ENUMERATOR && (used.number || used.s) && file) {
    const numberType =
      used.number && used.s ? '"{number}" and "%s"' : `${used.number ? '"number"' : '"%s"'}`;
    fileWarn(
      file,
      `Reference for "${node.identifier}" uses ${numberType} in the template, but node is not numbered.`,
      {
        node,
        note: 'The node was filled in with "??" as the number.',
        source: TRANSFORM_NAME,
        ruleId: RuleId.referenceTemplateFills,
      },
    );
  }
}

function kindFromNode(node: TargetNodes): TargetKind | string {
  if (node.type === 'container') return node.kind || TargetKind.figure;
  if (node.type === 'math' && node.kind === 'subequation') return TargetKind.subequation;
  if (node.type === 'math' || node.type === 'mathGroup') return TargetKind.equation;
  if ((node as any).kind) return `${node.type}:${(node as any).kind}`;
  return node.type;
}

function shouldEnumerateNode(
  node: TargetNodes,
  kind: TargetKind | string,
  numbering: Numbering,
  offset?: number,
): boolean {
  // Node may override enumeration from numbering frontmatter
  if (node.enumerated != null) return node.enumerated;
  const enabledDefault = numbering.all?.enabled ?? false;
  if (kind === 'heading' && node.type === 'heading') {
    return (
      numbering[`heading_${node.depth - (numbering?.title?.enabled ? 0 : 1) + (offset ?? 0)}`]
        ?.enabled ?? enabledDefault
    );
  }
  if (node.subcontainer) return numbering.subfigure?.enabled ?? enabledDefault;
  return numbering[kind]?.enabled ?? enabledDefault;
}

/**
 * Increment heading counts based on depth to increment
 *
 * depth is the depth to increment
 * counts is a list of 6 counts, corresponding to 6 heading depths
 *
 * When a certain depth is incremented, shallower depths are left the same
 * and deeper depths are reset to zero. Null counts anywhere are ignored.
 */
export function incrementHeadingCounts(
  depth: number,
  counts: (number | null)[],
): (number | null)[] {
  const incrementIndex = depth - 1;
  return counts.map((count, index) => {
    if (count === null || index < incrementIndex) return count;
    if (index === incrementIndex) return count + 1;
    return 0;
  });
}

/**
 * Format a positive integer counter as arabic / alph / Alph / roman / Roman.
 *
 * - `arabic` (default): 1, 2, 3, …
 * - `alph`  / `Alph`:   a, b, c, … z, aa, ab, … (excel-style overflow)
 * - `roman` / `Roman`:  i, ii, iii, iv, v, … (zero is empty)
 *
 * Non-positive values are returned as `String(value)` unchanged so callers
 * can pass 0 / negative sentinels without surprise.
 */
export function formatCounter(value: number, format?: CounterFormat): string {
  if (!format || format === 'arabic') return String(value);
  if (value <= 0) return String(value);
  if (format === 'alph' || format === 'Alph') {
    let n = value;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode('a'.charCodeAt(0) + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return format === 'Alph' ? out.toUpperCase() : out;
  }
  // roman / Roman
  const romans: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let n = value;
  let out = '';
  for (const [num, sym] of romans) {
    while (n >= num) {
      out += sym;
      n -= num;
    }
  }
  return format === 'Roman' ? out.toUpperCase() : out;
}

/**
 * Return dot-delimited header numbering based on heading counts
 *
 * counts is a list of 6 counts, corresponding to 6 heading depths
 *
 * Leading zeros are kept, trailing zeros are removed, nulls are ignored.
 *
 * Optional `formats` is a parallel list of per-depth counter formats; when
 * provided, each depth's count is rendered via `formatCounter`. Heading
 * depths without a format default to arabic, matching today's behaviour.
 */
export function formatHeadingEnumerator(
  counts: (number | null)[],
  prefix?: string,
  formats?: (CounterFormat | undefined)[],
): string {
  const pairs = counts.map((c, i) => [c, formats?.[i]] as const).filter(([c]) => c !== null) as [
    number,
    CounterFormat | undefined,
  ][];
  while (pairs.length && pairs[pairs.length - 1][0] === 0) {
    pairs.pop();
  }
  const enumerator = pairs.map(([c, fmt]) => formatCounter(c, fmt)).join('.');
  const out = prefix ? prefix.replace(/%s/g, String(enumerator)) : String(enumerator);
  return out;
}

function headingFormats(numbering: Numbering): (CounterFormat | undefined)[] {
  return [1, 2, 3, 4, 5, 6].map((d) => numbering[`heading_${d}`]?.format);
}

export function initializeTargetCounts(
  numbering: Numbering,
  previousCounts?: TargetCounts,
  offset?: number,
): TargetCounts {
  const heading = [1, 2, 3, 4, 5, 6].map((depth, ind) => {
    const cont = numbering[`heading_${depth}`]?.continue ?? numbering.all?.continue ?? false;
    const enabled = numbering[`heading_${depth}`]?.enabled ?? numbering.all?.enabled ?? true;
    const prevCount = previousCounts?.heading?.[ind];
    if (cont && enabled && prevCount !== undefined) {
      return prevCount;
    }
    if (numbering.title?.enabled && depth - 1 <= (offset ?? 0) && prevCount != null) {
      return prevCount;
    }
    if (!numbering.title?.enabled && depth <= (offset ?? 0)) {
      return null;
    }
    return 0;
  });

  const targetCounts = { heading } as TargetCounts;
  // Update with other initial values
  Object.entries(previousCounts ?? {})
    .filter(([key]) => key !== 'heading')
    .filter(([key]) => numbering[key]?.continue || numbering.all?.continue)
    .forEach(([key, val]) => {
      targetCounts[key] = { ...(val as { main: number; sub: number }) };
    });
  // Set the offset counts if the numbering defines start
  // These start values take priority over the initialCounts
  Object.entries(numbering).forEach(([key, val]) => {
    if (
      ['heading_1', 'heading_2', 'heading_3', 'heading_4', 'heading_5', 'heading_6'].includes(key)
    ) {
      const headingIndex = Number.parseInt(key.slice(-1), 10) - 1;
      if (val.enabled === false) {
        targetCounts.heading[headingIndex] = null;
      } else if (val.start) {
        targetCounts.heading[headingIndex] = val.start - 1;
      }
    } else if (val.start) {
      targetCounts[key] = { main: val.start - 1, sub: 0 };
    }
  });
  return targetCounts;
}

export interface IReferenceStateResolver {
  vfile: VFile;
  /**
   * If the page is provided, it will only look at that page.
   */
  getTarget: (identifier?: string, page?: string) => Target | undefined;
  getAllTargets: () => Target[];
  getFileTarget: (identifier?: string) => ReferenceState | undefined;
  getIdentifiers: () => string[];
  resolveReferenceContent: (node: ResolvableCrossReference) => void;
  resolveStateProvider: (identifier?: string, page?: string) => ReferenceState | undefined;
}

export class ReferenceState implements IReferenceStateResolver {
  vfile: VFile;
  filePath: string;
  url?: string;
  title?: string;
  dataUrl?: string;
  numbering: Numbering;
  targets: Record<string, Target>;
  targetCounts: TargetCounts;
  identifiers: string[];
  enumerator?: string;
  offset: number;
  /**
   * Per-kind last-seen scope-key (#27). When a scoped kind (e.g.
   * `proof:theorem` with `scope: section`) is incremented, the prefix
   * derived from the current heading counts is recorded here; if the
   * next increment of the same kind sees a different prefix, the main
   * counter resets. Empty on fresh pages — counter reset across pages
   * is governed by `targetCounts` carry-over, not this map.
   *
   * Keyed on the *resolved* counter kind (#34), so aliased kinds share
   * the slot owner's scope-key entry. Otherwise an alias chain would
   * trigger double resets at scope boundaries.
   */
  lastScopeKeyByKind: Record<string, string>;
  /**
   * Resolved `counter:` alias map (#34). Built once at construction
   * from the page's numbering frontmatter. Lookups go through
   * `effectiveCounterKind(this.resolvedCounters, kind)`. Kinds without
   * an alias are absent from the map and default to themselves.
   */
  resolvedCounters: Record<string, string>;

  constructor(
    filePath: string,
    opts?: {
      frontmatter?: PageFrontmatter;
      url?: string;
      dataUrl?: string;
      previousCounts?: TargetCounts;
      identifiers?: string[];
      vfile: VFile;
      hidden?: boolean;
    },
  ) {
    this.numbering = fillNumbering(opts?.frontmatter?.numbering, DEFAULT_NUMBERING);
    this.offset = this.numbering?.title?.offset ?? 0;
    this.targetCounts = initializeTargetCounts(this.numbering, opts?.previousCounts, this.offset);
    if (
      !opts?.hidden &&
      (this.numbering.title?.enabled || this.numbering.all?.enabled) &&
      !opts?.frontmatter?.content_includes_title &&
      this.numbering[`heading_${this.offset + 1}`]?.enabled !== false
    ) {
      this.targetCounts.heading = incrementHeadingCounts(
        this.offset + 1,
        this.targetCounts.heading,
      );
      this.enumerator = formatHeadingEnumerator(
        this.targetCounts.heading,
        this.numbering.title?.enumerator ?? this.numbering.enumerator?.enumerator,
        headingFormats(this.numbering),
      );
    }
    this.identifiers = opts?.identifiers ?? [];
    this.targets = {};
    this.vfile = opts?.vfile ?? new VFile();
    this.filePath = filePath;
    this.url = opts?.url;
    this.dataUrl = opts?.dataUrl;
    this.title = opts?.frontmatter?.title;
    this.lastScopeKeyByKind = {};
    this.resolvedCounters = buildResolvedCounterMap(this.numbering, this.vfile);
  }

  addTarget(node: TargetNodes, hidden?: boolean) {
    if (!isTargetIdentifierNode(node)) return;
    const kind = kindFromNode(node);
    const numberNode = !hidden && shouldEnumerateNode(node, kind, this.numbering, this.offset);
    if (numberNode) {
      this.incrementCount(node, kind as TargetKind);
    }
    if (!(node as any).html_id) {
      (node as any).html_id = createHtmlId(node.identifier);
    }
    if (!node.identifier) return;
    if (this.targets[node.identifier] || this.identifiers.includes(node.identifier)) {
      if (!this.vfile) return;
      if ((node as any).implicit) return; // Do not warn on implicit headings
      fileWarn(this.vfile, `Duplicate identifier in file "${node.identifier}"`, {
        node,
        source: TRANSFORM_NAME,
        ruleId: RuleId.identifierIsUnique,
      });
      return;
    }
    this.targets[node.identifier] = {
      node,
      kind: kind as TargetKind,
    };
  }

  resolveEnumerator(val: any, enumerator?: string): string {
    const prefix = enumerator ?? this.numbering.enumerator?.enumerator;
    return prefix ? prefix.replace(/%s/g, String(val)) : String(val);
  }

  /**
   * Increment target count state for container/equation nodes
   *
   * Updates node `enumerator` in place.
   *
   * If node is subcontainer/subequation, a sub-count is incremented
   */
  incrementCount(node: TargetNodes, kind: TargetKind | string): string {
    if (node.enumerator) {
      // If the enumerator is explicitly defined, return early
      // This is the case if the figure, for example, has an enumerator set (e.g. `2a`)
      // The other numbering will not be affected, and may be wrong
      return node.enumerator;
    }
    let enumerator: string | number;
    if (kind === TargetKind.heading && node.type === 'heading') {
      this.targetCounts.heading = incrementHeadingCounts(
        node.depth - (this.numbering?.title?.enabled ? 0 : 1) + this.offset,
        this.targetCounts.heading,
      );
      enumerator = formatHeadingEnumerator(
        this.targetCounts.heading,
        this.numbering[
          `heading_${node.depth - (this.numbering?.title?.enabled ? 0 : 1) + this.offset}`
        ]?.enumerator ?? this.numbering.enumerator?.enumerator,
        headingFormats(this.numbering),
      );
      node.enumerator = enumerator;
      return enumerator;
    }
    const countKind = kind === TargetKind.subequation ? TargetKind.equation : kind;
    // #34: when `numbering[countKind].counter` is set (proof-family
    // only, e.g. `proof:lemma → proof:theorem`), every counter mechanic
    // — target slot, scope-key tracking, format lookup, continue,
    // scope depth — reads from the slot owner. Rendering (the
    // enumerator wrap template) stays per-kind so an aliased lemma
    // still renders "Lemma %s" while sharing the theorem counter slot.
    // For non-aliased kinds and the subequation→equation mapping,
    // `slotKind` equals `countKind` and behavior is unchanged.
    const slotKind = effectiveCounterKind(this.resolvedCounters, countKind);
    // Ensure target slot is instantiated
    this.targetCounts[slotKind] ??= { main: 0, sub: 0 };
    const kindFormat = this.numbering[slotKind]?.format;
    // §3.2(e) auto-prefix: in book mode, prepend the active chapter or
    // appendix enumerator (this.enumerator — the page's H1 number / letter)
    // so figures render "3.1", "A.2", etc. Pages in front/back matter have
    // no this.enumerator, so the flat global counter is used automatically.
    // Per-kind `continue: true` (§3.4(6)) opts out and keeps the counter
    // flat across pages.
    const continueKind = this.numbering[slotKind]?.continue || this.numbering.all?.continue;
    let autoPrefix = '';
    if (
      this.enumerator &&
      this.numbering.book?.enabled &&
      !continueKind &&
      shouldAutoPrefix(countKind)
    ) {
      // #27: scope > 1 means "go deeper than the chapter prefix" — e.g.
      // `Theorem 5.1.2` from chapter 5, section 1, second theorem. The
      // counter must also reset on each scope boundary (e.g. new heading_2),
      // so we track the last-seen scope key per slot and reset main/sub
      // when it changes. Scope == 1 keeps today's behaviour exactly.
      const scopeDepth = effectiveScopeDepth(this.numbering, slotKind);
      if (scopeDepth > 1) {
        const scopePrefix = formatHeadingPrefix(
          this.targetCounts.heading,
          scopeDepth,
          headingFormats(this.numbering),
        );
        autoPrefix = scopePrefix ? `${scopePrefix}.` : '';
        // Reset only on a real scope *change* — i.e. we've already seen
        // this slot at a different scope key. Resetting on *first*
        // encounter would clobber `numbering[slotKind].start` seeded by
        // `initializeTargetCounts`, so e.g. `figure: { start: 5, scope:
        // section }` would silently render `5.1.1` instead of `5.1.5`.
        // #34: keying on `slotKind` (not `countKind`) means aliased
        // kinds share the slot owner's scope-key entry; otherwise a
        // chain like `lemma→theorem` would trigger double resets on
        // each scope crossing.
        const prevScopeKey = this.lastScopeKeyByKind[slotKind];
        if (prevScopeKey !== undefined && prevScopeKey !== scopePrefix) {
          this.targetCounts[slotKind] = { main: 0, sub: 0 };
        }
        this.lastScopeKeyByKind[slotKind] = scopePrefix;
      } else {
        autoPrefix = `${this.enumerator}.`;
      }
    }
    if (node.subcontainer || kind === TargetKind.subequation) {
      this.targetCounts[slotKind].sub += 1;
      // Will restart counting if there are more than 26 subequations/figures
      const letter = String.fromCharCode(
        ((this.targetCounts[slotKind].sub - 1) % 26) + 'a'.charCodeAt(0),
      );
      if (node.subcontainer) {
        node.parentEnumerator = this.resolveEnumerator(
          autoPrefix + formatCounter(this.targetCounts[slotKind].main, kindFormat),
          this.numbering[countKind]?.enumerator,
        );
        enumerator = letter;
      } else {
        enumerator = this.resolveEnumerator(
          autoPrefix + formatCounter(this.targetCounts[slotKind].main, kindFormat) + letter,
          this.numbering[countKind]?.enumerator,
        );
      }
    } else {
      this.targetCounts[slotKind].main += 1;
      this.targetCounts[slotKind].sub = 0;
      enumerator = this.resolveEnumerator(
        autoPrefix + formatCounter(this.targetCounts[slotKind].main, kindFormat),
        this.numbering[kind]?.enumerator,
      );
    }
    node.enumerator = enumerator;
    return enumerator;
  }

  resolveStateProvider(identifier?: string, page?: string): ReferenceState | undefined {
    if (!identifier || !page || page !== this.filePath) return;
    if (this.getTarget(identifier) || this.getFileTarget(identifier)) return this;
  }

  getIdentifiers() {
    return [...this.identifiers, ...Object.keys(this.targets)];
  }

  getTarget(identifier?: string): Target | undefined {
    if (!identifier) return undefined;
    return this.targets[identifier];
  }

  getAllTargets(): Target[] {
    return [...Object.values(this.targets)];
  }

  getFileTarget(identifier?: string): ReferenceState | undefined {
    if (!identifier) return undefined;
    if (this.identifiers.includes(identifier)) return this;
  }

  resolveReferenceContent(node: ResolvableCrossReference) {
    const fileTarget = this.getFileTarget(node.identifier);
    if (fileTarget) {
      const { url, title, dataUrl, enumerator } = fileTarget;
      if (url) {
        const nodeAsLink = node as unknown as Link;
        nodeAsLink.type = 'link';
        nodeAsLink.url = url;
        nodeAsLink.internal = true;
        if (dataUrl) nodeAsLink.dataUrl = dataUrl;
        // §3.2(h): file-targets are the page's title heading, so apply the
        // same label > template > title fallback used for inline headings.
        // Use the page's offset to pick the same heading numbering item that
        // was used when its enumerator was generated — a nested TOC page
        // with offset=1 should read `heading_2`, not `heading_1`. Otherwise
        // a sub-section under a book chapter would render as e.g.
        // "Chapter 1.1" instead of "Section 1.1".
        let text: string | undefined;
        if (enumerator) {
          const depth = (fileTarget.offset ?? 0) + 1;
          const item = fileTarget.numbering?.[`heading_${depth}`];
          const template = item?.label ?? item?.template;
          if (template) text = template.replace(/%s/g, enumerator);
        }
        updateLinkTextIfEmpty(nodeAsLink, text ?? title ?? url);
      }
      return;
    }
    const target = this.getTarget(node.identifier);
    if (!target) {
      warnNodeTargetNotFound(node, this.vfile);
      return;
    }
    // Put the kind on the node so we can use that later
    node.kind = target.kind;
    addChildrenFromTargetNode(node, target.node, this.numbering, this.vfile, this.offset);
  }
}

export function addChildrenFromTargetNode(
  node: ResolvableCrossReference,
  targetNode: TargetNodes,
  numbering?: Numbering,
  vfile?: VFile,
  offset?: number,
) {
  numbering = fillNumbering(numbering, DEFAULT_NUMBERING);
  const kind = kindFromNode(targetNode);
  const noNodeChildren = !node.children?.length;
  if (kind === TargetKind.heading) {
    // §3.4(8) / #12 fix: a heading that nominally has numbering enabled but
    // never received an enumerator (e.g. on a page with page-level
    // `numbering: false`, or under frontmatter:/backmatter: in book mode)
    // must fall through to the title-only template. Otherwise `%s` in the
    // heading template substitutes against UNKNOWN_REFERENCE_ENUMERATOR and
    // renders "Chapter ??".
    const numberHeading =
      shouldEnumerateNode(targetNode, TargetKind.heading, numbering) && !!targetNode.enumerator;
    const template = getReferenceTemplate(
      { node: targetNode, kind },
      numbering,
      numberHeading,
      true,
      offset,
    );
    fillReferenceEnumerators(
      vfile,
      node,
      template,
      targetNode,
      copyNode(targetNode as Heading).children as PhrasingContent[],
    );
  } else {
    // By default look into the caption or admonition title if it exists
    const caption =
      select('caption', targetNode) ||
      select('admonitionTitle', targetNode) ||
      select('definitionTerm', targetNode);
    // Ensure we are getting the first paragraph
    const captionParagraph = (
      caption ? (select('paragraph', caption) ?? caption) : caption
    ) as Paragraph | null;
    const title = captionParagraph
      ? (copyNode(captionParagraph)?.children as PhrasingContent[])
      : undefined;
    if (title && node.kind === ReferenceKind.ref && noNodeChildren) {
      node.children = title as any;
    }
    const template = getReferenceTemplate(
      { node: targetNode, kind },
      numbering,
      !!targetNode.enumerator,
      !!title,
      offset,
    );
    fillReferenceEnumerators(vfile, node, template, targetNode, title);
  }
  node.resolved = true;
  // The identifier may have changed in the lookup, but unlikely
  node.identifier = targetNode.identifier ?? node.identifier;
  node.html_id = targetNode.html_id ?? node.html_id;
}

function warnNodeTargetNotFound(node: ResolvableCrossReference, vfile?: VFile) {
  if (!vfile) return;
  fileWarn(vfile, `Cross reference target was not found: ${node.identifier}`, {
    node,
    source: TRANSFORM_NAME,
    ruleId: RuleId.referenceTargetResolves,
  });
}

export class MultiPageReferenceResolver implements IReferenceStateResolver {
  states: ReferenceState[];
  filePath: string; // Path of the current file we are resolving references against
  vfile: VFile; // VFile for reporting errors/warnings

  constructor(states: ReferenceState[], filePath: string, vfile = new VFile()) {
    this.states = states;
    this.filePath = filePath;
    this.vfile = vfile;
  }

  resolveStateProvider(identifier?: string, page?: string): ReferenceState | undefined {
    if (!identifier) return undefined;
    const resolvedState = this.states.find((state) => {
      if (page && page !== state.filePath) return false;
      return !!state.getTarget(identifier) || !!state.getFileTarget(identifier);
    });
    return resolvedState;
  }

  getIdentifiers() {
    return this.states.map((state) => state.getIdentifiers()).flat();
  }

  getTarget(identifier?: string, page?: string): Target | undefined {
    const state = this.resolveStateProvider(identifier, page);
    return state?.getTarget(identifier);
  }

  getAllTargets(): Target[] {
    return this.states.map((state) => state.getAllTargets()).flat();
  }

  getFileTarget(identifier?: string): ReferenceState | undefined {
    if (!identifier) return undefined;
    return this.states.map((state) => state.getFileTarget(identifier)).find((file) => !!file);
  }

  resolveReferenceContent(node: ResolvableCrossReference) {
    const state = this.resolveStateProvider(node.identifier);
    if (!state) {
      warnNodeTargetNotFound(node, this.vfile);
      return;
    }
    state?.resolveReferenceContent(node);
    if (node.resolved && state?.filePath !== this.filePath) {
      node.remote = true;
      node.url = state.url || undefined;
      node.dataUrl = state.dataUrl || undefined;
    }
  }
}

export const enumerateTargetsTransform = (tree: GenericParent, opts: StateOptions) => {
  visit(tree, (node) => {
    if (!isTargetIdentifierNode(node)) return;
    if (
      node.identifier ||
      node.enumerated ||
      ['container', 'mathGroup', 'math', 'heading', 'proof'].includes(node.type)
    ) {
      opts.state.addTarget(node as TargetNodes, opts?.hidden);
    }
  });
  // Add implicit labels to subfigures without explicit labels
  // This must happen after initial enumeration, as implicit subfigure labels are dependent on enumerators
  (selectAll('container', tree) as Container[])
    .filter((container: Container) => !container.subcontainer)
    .forEach((parent) => {
      (selectAll('container[subcontainer]', parent) as Container[]).forEach((sub) => {
        const parentLabel = parent.label ?? parent.identifier;
        if (sub.identifier || !parentLabel || !sub.enumerator) return;
        const { label, identifier } = normalizeLabel(`${parentLabel}-${sub.enumerator}`) ?? {};
        sub.label = label;
        sub.identifier = identifier;
        (sub as any).implicit = true;
        // This is the second time addTarget is called on this node.
        // The first time, it was given an enumerator but not added to targets.
        // This time, it is added to targets since it now has an identifier.
        opts.state.addTarget(sub as TargetNodes, opts?.hidden);
      });
    });
  return tree;
};

export const enumerateTargetsPlugin: Plugin<[StateOptions], GenericParent, GenericParent> =
  (opts) => (tree) => {
    enumerateTargetsTransform(tree, opts);
  };

function getCaptionLabel(kind?: Container['kind'], subcontainer?: boolean, numbering?: Numbering) {
  if (subcontainer && (kind === 'equation' || kind === 'subequation')) return `(%s)`;
  if (subcontainer) return `({subEnumerator})`;
  // The caption noun follows the configured template, matching what
  // cross-references render (e.g. `numbering.code.template: "Listing %s"`);
  // containers without a kind are figures (matching kindFromNode)
  const effectiveKind = kind || 'figure';
  const template =
    numbering?.[effectiveKind]?.template ?? getDefaultNumberedReferenceTemplate(effectiveKind);
  return `${template}:`;
}

/** Visit all containers and add captionNumber node to caption paragraph
 *
 * Requires container to be enumerated.
 *
 * By default, captionNumber is only added if caption already exists.
 * However, for sub-containers, captionNumber is always added.
 */
export function addContainerCaptionNumbersTransform(
  tree: GenericParent,
  file: VFile,
  opts: StateResolverOptions,
) {
  const containers = selectAll('container', tree) as Container[];
  containers
    .filter((container: Container) => container.enumerator)
    .forEach((container: Container) => {
      // Resolve the providing page state once: it serves both the target
      // lookup and the numbering selection below. Single-page states do not
      // resolve without a page argument but carry the numbering directly.
      const stateProvider = opts.state.resolveStateProvider(container.identifier);
      const target = (stateProvider ?? opts.state).getTarget(container.identifier)?.node;
      if (!target?.enumerator) return;
      // Only look for direct caption children
      let para = select(
        'paragraph',
        container.children.find((child) => child.type === 'caption'),
      ) as GenericParent;
      // Always add subcontainer caption number, even if there is no other caption
      if (container.subcontainer && !para) {
        para = { type: 'paragraph', children: [] };
        container.children.push({ type: 'caption', children: [para] } as GenericNode);
      }
      if (para && (para.children[0]?.type as string) === 'captionNumber') {
        para.children = para.children.slice(1);
      }
      if (para) {
        const captionNumber = {
          type: 'captionNumber',
          kind: container.kind,
          label: container.label,
          identifier: container.identifier,
          html_id: (container as any).html_id,
          enumerator: target.enumerator,
        };
        const numbering =
          stateProvider?.numbering ?? (opts.state as { numbering?: Numbering }).numbering;
        fillReferenceEnumerators(
          file,
          captionNumber,
          getCaptionLabel(container.kind, container.subcontainer, numbering),
          target,
        );
        // The caption number is in the paragraph, it needs a link to the figure container
        // This is a bit awkward, but necessary for (efficient) rendering
        para.children = [captionNumber as any, ...(para?.children ?? [])];
      }
    });
}

/**
 * Raise a warning if `target` linked by `node` has an implicit reference
 */
function implicitTargetWarning(target: Target, node: GenericNode, opts: StateResolverOptions) {
  // suppressImplicitWarning is used, for example, in the table of contents directive
  if ((target.node as GenericNode).implicit && opts.state.vfile && !node.suppressImplicitWarning) {
    fileWarn(
      opts.state.vfile,
      `Linking "${target.node.identifier}" to an implicit ${target.kind} reference, best practice is to create an explicit reference.`,
      {
        node,
        note: 'Explicit references do not break when you update the title to a section, they are preferred over using the implicit HTML ID created for headers.',
        source: TRANSFORM_NAME,
        ruleId: RuleId.referenceTargetExplicit,
      },
    );
  }
  delete node.suppressImplicitWarning;
}

export const resolveReferenceLinksTransform = (tree: GenericParent, opts: StateResolverOptions) => {
  selectAll('link', tree).forEach((node) => {
    const link = node as Link;
    if (!link.url) {
      fileError(opts.state.vfile, `Link has no URL: ${toText(link.children)}`, {
        node,
        source: TRANSFORM_NAME,
        ruleId: RuleId.mystLinkValid,
        key: link.urlSource ?? link.url,
      });
      return;
    }
    const identifier = link.url.replace(/^#/, '');
    const reference = normalizeLabel(identifier);
    const target = opts.state.getTarget(identifier) ?? opts.state.getTarget(reference?.identifier);
    const fileTarget = opts.state.getFileTarget(reference?.identifier);
    if (!(target || fileTarget) || !reference) {
      if (!opts.state.vfile || !link.url.startsWith('#')) return;
      // Only warn on explicit internal URLs
      fileWarn(opts.state.vfile, `No target for internal reference "${link.url}" was found.`, {
        node,
        source: TRANSFORM_NAME,
        ruleId: RuleId.referenceTargetResolves,
        key: link.urlSource ?? link.url,
      });
      return;
    }
    if (!link.url.startsWith('#') && opts.state.vfile) {
      fileWarn(
        opts.state.vfile,
        `Legacy syntax used for link target, please prepend a '#' to your link url: "${link.url}"`,
        {
          node,
          note: 'The link target should be of the form `[](#target)`, including the `#` sign.\nThis may be deprecated in the future.',
          source: TRANSFORM_NAME,
          ruleId: RuleId.referenceSyntaxValid,
          key: link.urlSource ?? link.url,
        },
      );
      const source = (link as any).urlSource;
      if (source) {
        (link as any).urlSource = `#${source}`;
      }
    }
    // Change the link into a cross-reference!
    const xref = link as unknown as CrossReference;
    xref.type = 'crossReference';
    xref.identifier = reference.identifier;
    xref.label = reference.label;
    delete xref.kind; // This will be deprecated, no need to set, and remove if it is there
    delete (xref as any).url;
    if (target) implicitTargetWarning(target, node, opts);
  });
};

export const resolveUnlinkedCitations = (tree: GenericParent, opts: StateResolverOptions) => {
  selectAll('cite', tree).forEach((node) => {
    const cite = node as Cite;
    if (!cite.error) return;
    const reference = normalizeLabel(cite.label);
    if (reference) {
      const target = opts.state.getTarget(cite.label) ?? opts.state.getTarget(reference.identifier);
      const fileTarget = opts.state.getFileTarget(reference.identifier);
      if (target || fileTarget) {
        // Change the cite into a cross-reference!
        const xref = cite as unknown as CrossReference;
        xref.type = 'crossReference';
        xref.identifier = reference.identifier;
        xref.label = reference.label;
        delete cite.error;
        if (target) implicitTargetWarning(target, node, opts);
        return;
      }
    }
    const transformer = opts.transformers?.find((t) => t.test(cite.label));
    if (transformer) {
      // Change the cite into a link for LinkTransformer to handle later
      const link = cite as unknown as Link;
      link.type = 'link';
      link.url = cite.label;
      delete cite.error;
      return;
    }
    if (!opts.state.vfile) return;
    fileWarn(opts.state.vfile, `Could not link citation with label "${cite.label}".`, {
      node,
      source: TRANSFORM_NAME,
      ruleId: RuleId.referenceTargetResolves,
    });
  });
};

/** Cross references cannot contain links, but should retain their content */
function unnestCrossReferencesTransform(tree: GenericParent) {
  const xrefs = selectAll('crossReference', tree) as GenericNode[];
  xrefs.forEach((xref) => {
    const children = xref.children as any;
    if (!children) return;
    const subtree = { type: 'root', children: copyNode(children) } as any;
    const nested = select('crossReference,link', subtree);
    if (!nested) return;
    liftChildren(subtree, 'link');
    liftChildren(subtree, 'crossReference');
    xref.children = subtree.children;
  });
  return tree.children as PhrasingContent[];
}

export const resolveCrossReferencesTransform = (
  tree: GenericParent,
  opts: StateResolverOptions,
) => {
  visit(tree, 'crossReference', (node: CrossReference) => {
    // If protocol is set, this came from a LinkTransformer and will not be touched here
    const { protocol } = node as any;
    if (protocol && protocol !== 'file') return;
    opts.state.resolveReferenceContent(node);
  });
};

export const resolveLinksAndCitationsTransform = (
  tree: GenericParent,
  opts: StateResolverOptions,
) => {
  resolveReferenceLinksTransform(tree, opts);
  resolveUnlinkedCitations(tree, opts);
};

export const resolveReferencesTransform = (
  tree: GenericParent,
  file: VFile,
  opts: StateResolverOptions,
) => {
  resolveCrossReferencesTransform(tree, opts);
  addContainerCaptionNumbersTransform(tree, file, opts);
  unnestCrossReferencesTransform(tree);
};

export const resolveReferencesPlugin: Plugin<
  [StateResolverOptions],
  GenericParent,
  GenericParent
> = (opts) => (tree, file) => {
  resolveLinksAndCitationsTransform(tree, opts);
  resolveReferencesTransform(tree, file, opts);
};
