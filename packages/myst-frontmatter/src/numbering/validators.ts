import type { ValidationOptions } from 'simple-validators';
import {
  defined,
  fillMissingKeys,
  incrementOptions,
  validateBoolean,
  validateNumber,
  validateObjectKeys,
  validateString,
  validationWarning,
} from 'simple-validators';
import type { CounterFormat, Numbering, NumberingItem, NumberingScope } from './types.js';

export const NUMBERING_OPTIONS = ['enumerator', 'all', 'headings', 'title'];

const HEADING_KEYS = ['heading_1', 'heading_2', 'heading_3', 'heading_4', 'heading_5', 'heading_6'];
const BOOK_SECTION_KEYS = ['parts', 'chapters', 'appendices'];
export const NUMBERING_KEYS = [
  'book',
  'figure',
  'subfigure',
  'equation',
  'subequation',
  'table',
  'code',
  ...BOOK_SECTION_KEYS,
  ...HEADING_KEYS,
];

const NUMBERING_ITEM_KEYS = [
  'enabled',
  'start',
  'enumerator',
  'template',
  'continue',
  'format',
  'label',
  'reset_on_part',
  'scope',
  'counter',
];

/**
 * Counter-mechanics fields that are read from the slot owner when a kind
 * is aliased via `counter:` (#34). Setting these on an aliased kind has
 * no effect — the slot's owner wins — so the validator warns and drops
 * them to keep the rendered output consistent with the LaTeX
 * `\newtheorem{name}[other]{Heading}` semantics this models.
 *
 * `label` and `template` (the "{Heading}" arg) are intentionally absent:
 * they remain per-kind so an aliased `lemma` still renders "Lemma 1.2.2"
 * while sharing the theorem counter slot.
 */
const COUNTER_OWNER_FIELDS = ['start', 'format', 'continue', 'reset_on_part', 'scope'] as const;

/**
 * Is this kind a proof-family kind for the purposes of `counter:`
 * aliasing (#34)? Mirrors `isProofFamilyKind` in
 * `myst-transforms/src/enumerate.ts` — both files need to agree on the
 * family membership rule but neither owns it conceptually, so each
 * keeps a local copy rather than introducing a shared dependency.
 */
function isProofFamilyKindForCounter(kind: string): boolean {
  return kind === 'proof' || kind.startsWith('proof:') || kind.startsWith('prf:');
}

/**
 * Normalize a bare proof-family `counter:` target (`theorem`) to its
 * fully-qualified form (`proof:theorem`). The key — not the value — is
 * always fully qualified in the numbering object, so authors who write
 * `proof:lemma: { counter: theorem }` (the LaTeX-natural form) and
 * authors who write `counter: proof:theorem` (the verbose form) both
 * get the same resolution. Cross-family targets are returned as-is so
 * the engine's family check can warn on them.
 */
function normalizeCounterTarget(keyKind: string, target: string): string {
  if (target.includes(':')) return target;
  if (isProofFamilyKindForCounter(keyKind)) return `proof:${target}`;
  return target;
}

const COUNTER_FORMATS: CounterFormat[] = ['arabic', 'alph', 'Alph', 'roman', 'Roman'];

const CONTINUE_STRINGS = ['continue', 'next'];

/**
 * Single source of truth for `numbering.<kind>.scope` aliases (#27).
 * Maps every accepted spelling to its canonical `heading_N` form.
 * Both the validator (which normalises to `heading_N`) and consumers
 * that need the depth integer (e.g. `myst-transforms/src/enumerate.ts`'s
 * `effectiveScopeDepth`) import this and `scopeAliasToDepth` rather
 * than maintaining parallel switch statements.
 */
export const SCOPE_ALIASES: Record<string, string> = {
  chapter: 'heading_1',
  section: 'heading_2',
  subsection: 'heading_3',
  subsubsection: 'heading_4',
  heading_1: 'heading_1',
  heading_2: 'heading_2',
  heading_3: 'heading_3',
  heading_4: 'heading_4',
  heading_5: 'heading_5',
  heading_6: 'heading_6',
};
export const SCOPE_VALUES = Object.keys(SCOPE_ALIASES);

/**
 * Resolve a scope alias (`chapter`/`section`/`heading_N`/…) to its
 * heading depth (1-based). Returns `undefined` for unrecognised values
 * so the caller can fall through to the next candidate.
 */
export function scopeAliasToDepth(scope: string): number | undefined {
  const canonical = SCOPE_ALIASES[scope];
  if (!canonical) return undefined;
  return Number(canonical.slice('heading_'.length));
}

export const NUMBERING_ALIAS = {
  sections: 'headings',
  h1: 'heading_1',
  h2: 'heading_2',
  h3: 'heading_3',
  h4: 'heading_4',
  h5: 'heading_5',
  h6: 'heading_6',
  heading1: 'heading_1',
  heading2: 'heading_2',
  heading3: 'heading_3',
  heading4: 'heading_4',
  heading5: 'heading_5',
  heading6: 'heading_6',
  figures: 'figure',
  subfigures: 'subfigure',
  equations: 'equation',
  math: 'equation',
  subequations: 'subequation',
  tables: 'table',
  titles: 'title',
};

function isBoolean(input: any) {
  if (typeof input === 'string') {
    return ['true', 'false'].includes(input.toLowerCase());
  }
  return typeof input === 'boolean';
}

/**
 * Validate value for each numbering entry
 *
 * Value may be:
 * - boolean, to simply enable/disable numbering
 * - number, to indicate the starting number
 * - string, to define the cross-reference template
 *   (e.g. 'Fig. %s' to get "Fig. 1" instead of "Figure 1" in your document)
 * - An object with any of enabled/start/template - specifying the above types
 *   will coerce to this object
 */
export function validateNumberingItem(
  input: any,
  opts: ValidationOptions,
): NumberingItem | undefined {
  if (isBoolean(input)) {
    input = { enabled: input };
  } else if (typeof input === 'number') {
    input = { start: input };
  } else if (CONTINUE_STRINGS.includes(input)) {
    input = { continue: true };
  } else if (typeof input === 'string') {
    input = { template: input };
  }
  const value = validateObjectKeys(input, { optional: NUMBERING_ITEM_KEYS }, opts);
  if (value === undefined) return undefined;
  const output: NumberingItem = {};
  if (defined(value.enabled)) {
    const enabled = validateBoolean(value.enabled, incrementOptions('enabled', opts));
    if (defined(enabled)) output.enabled = enabled;
  }
  if (defined(value.start)) {
    if (CONTINUE_STRINGS.includes(value.start) && !defined(value.continue)) {
      output.continue = true;
      output.enabled = output.enabled ?? true;
    } else {
      const start = validateNumber(value.start, {
        ...incrementOptions('start', opts),
        integer: true,
        min: 1,
      });
      if (start) {
        output.start = start;
        output.enabled = output.enabled ?? true;
      }
    }
  }
  if (defined(value.template)) {
    const template = validateString(value.template, incrementOptions('template', opts));
    if (defined(template)) {
      output.template = template;
      output.enabled = output.enabled ?? true;
    }
  }
  if (defined(value.enumerator)) {
    const enumerator = validateString(value.enumerator, incrementOptions('enumerator', opts));
    if (defined(enumerator)) {
      output.enumerator = enumerator;
      output.enabled = output.enabled ?? true;
    }
  }
  if (defined(value.continue)) {
    const cont = validateBoolean(value.continue, incrementOptions('continue', opts));
    if (defined(cont)) {
      output.continue = cont;
      output.enabled = output.enabled ?? true;
    }
  }
  if (defined(value.format)) {
    const formatOpts = incrementOptions('format', opts);
    const formatStr = validateString(value.format, formatOpts);
    if (defined(formatStr)) {
      if ((COUNTER_FORMATS as string[]).includes(formatStr)) {
        output.format = formatStr as CounterFormat;
        output.enabled = output.enabled ?? true;
      } else {
        validationWarning(
          `must be one of: ${COUNTER_FORMATS.join(', ')} (got "${formatStr}")`,
          formatOpts,
        );
      }
    }
  }
  if (defined(value.label)) {
    const label = validateString(value.label, incrementOptions('label', opts));
    if (defined(label)) {
      output.label = label;
      output.enabled = output.enabled ?? true;
    }
  }
  if (defined(value.reset_on_part)) {
    const resetOnPart = validateBoolean(
      value.reset_on_part,
      incrementOptions('reset_on_part', opts),
    );
    if (defined(resetOnPart)) {
      output.reset_on_part = resetOnPart;
      output.enabled = output.enabled ?? true;
    }
  }
  if (defined(value.scope)) {
    const scopeOpts = incrementOptions('scope', opts);
    const scopeStr = validateString(value.scope, scopeOpts);
    if (defined(scopeStr)) {
      const normalized = SCOPE_ALIASES[scopeStr];
      if (normalized) {
        output.scope = normalized as NumberingScope;
        output.enabled = output.enabled ?? true;
      } else {
        validationWarning(
          `must be one of: ${SCOPE_VALUES.join(', ')} (got "${scopeStr}")`,
          scopeOpts,
        );
      }
    }
  }
  if (defined(value.counter)) {
    const counter = validateString(value.counter, incrementOptions('counter', opts));
    if (defined(counter)) {
      output.counter = counter;
      output.enabled = output.enabled ?? true;
    }
  }
  if (Object.keys(output).length === 0) return undefined;
  return output;
}

export function validateTitleItem(input: any, opts: ValidationOptions): NumberingItem | undefined {
  if (isBoolean(input)) {
    input = { enabled: input };
  } else if (typeof input === 'number') {
    input = { offset: input };
  }
  const value = validateObjectKeys(input, { optional: ['enabled', 'offset', 'enumerator'] }, opts);
  if (value === undefined) return undefined;
  const output: { enabled?: boolean; offset?: number; enumerator?: string } = {};
  if (defined(value.enabled)) {
    const enabled = validateBoolean(value.enabled, incrementOptions('enabled', opts));
    if (defined(enabled)) output.enabled = enabled;
  }
  if (defined(value.offset)) {
    const offset = validateNumber(value.offset, {
      integer: true,
      min: 0,
      max: 5,
      ...incrementOptions('offset', opts),
    });
    if (defined(offset)) {
      output.offset = offset;
      output.enabled = output.enabled ?? true;
    }
  }
  if (defined(value.enumerator)) {
    const enumerator = validateString(value.enumerator, incrementOptions('enumerator', opts));
    if (defined(enumerator)) {
      output.enumerator = enumerator;
      output.enabled = output.enabled ?? true;
    }
  }
  if (Object.keys(output).length === 0) return undefined;
  return output;
}

/**
 * Validate Numbering object
 */
export function validateNumbering(input: any, opts: ValidationOptions): Numbering | undefined {
  if (isBoolean(input)) {
    input = { all: input };
  }
  const value = validateObjectKeys(
    input,
    { optional: [...NUMBERING_KEYS, ...NUMBERING_OPTIONS], alias: NUMBERING_ALIAS },
    { ...opts, suppressWarnings: true, keepExtraKeys: true },
  );
  if (value === undefined) return undefined;
  const output: Numbering = {};
  let headings: NumberingItem | undefined;
  if (defined(value.enumerator)) {
    const enumeratorOpts = incrementOptions('enumerator', opts);
    if (typeof value.enumerator === 'string') {
      value.enumerator = { enumerator: value.enumerator };
    }
    output.enumerator = validateNumberingItem(value.enumerator, enumeratorOpts);
    if (output.enumerator?.enabled != null) {
      if (output.enumerator.enabled !== true) {
        validationWarning("value for 'enabled' is ignored", enumeratorOpts);
      }
      delete output.enumerator.enabled;
    }
    if (output.enumerator?.start != null) {
      validationWarning("value for 'start' is ignored", enumeratorOpts);
      delete output.enumerator.start;
    }
    if (output.enumerator?.continue != null) {
      validationWarning("value for 'continue' is ignored", enumeratorOpts);
      delete output.enumerator.continue;
    }
    if (!output.enumerator || Object.keys(output.enumerator).length === 0) {
      delete output.enumerator;
    }
  }
  if (defined(value.all)) {
    const allOpts = incrementOptions('all', opts);
    output.all = validateNumberingItem(value.all, allOpts);
    if (output.all?.template != null) {
      validationWarning("value for 'template' is ignored", allOpts);
      delete output.all.template;
    }
    if (output.all?.start != null) {
      validationWarning("value for 'start' is ignored", allOpts);
      delete output.all.start;
    }
    if (!output.all || Object.keys(output.all).length === 0) {
      delete output.all;
    }
  }
  if (defined(value.title)) {
    output.title = validateTitleItem(value.title, incrementOptions('title', opts));
  }
  if (defined(value.headings)) {
    headings = validateNumberingItem(value.headings, incrementOptions('headings', opts));
    HEADING_KEYS.forEach((headingKey) => {
      if (headings && !defined(value[headingKey])) {
        value[headingKey] = headings;
      }
    });
  }
  Object.keys(value)
    .filter((key) => !NUMBERING_OPTIONS.includes(key)) // For all the unknown options
    .forEach((key) => {
      if (defined(value[key])) {
        const item = validateNumberingItem(value[key], incrementOptions(key, opts));
        if (!defined(item)) return;
        if (headings && HEADING_KEYS.includes(key)) {
          output[key] = { ...headings, ...item };
        } else {
          output[key] = item;
        }
      }
    });
  // #34: post-process `counter:` aliases — normalize bare proof-family
  // targets to their fully-qualified form, and warn (then drop) any
  // counter-mechanics fields set on aliased kinds. Cycle detection and
  // cross-family enforcement happen at runtime in
  // `myst-transforms/src/enumerate.ts` where node-attached warnings are
  // natural; here we only handle the per-entry concerns the validator
  // already has full local knowledge of.
  //
  // The owner-field drop is gated on the *key* being a proof-family
  // kind. Cross-family entries (`figure.counter: proof:theorem`) keep
  // both their `counter` field (so the engine can emit its family
  // warning) and all their owner-fields (`figure.start`, `figure.scope`,
  // etc.) intact — otherwise a typo'd alias would silently delete
  // valid configuration the engine then refuses to honor.
  Object.entries(output)
    .filter(([key]) => !NUMBERING_OPTIONS.includes(key))
    .forEach(([key, item]) => {
      if (!item?.counter) return;
      const normalized = normalizeCounterTarget(key, item.counter);
      if (normalized !== item.counter) item.counter = normalized;
      if (!isProofFamilyKindForCounter(key)) return;
      const itemOpts = incrementOptions(key, opts);
      for (const field of COUNTER_OWNER_FIELDS) {
        if (defined((item as any)[field])) {
          validationWarning(
            `'${field}' is read from the slot owner ('${item.counter}') when 'counter' is set; ignoring on '${key}'`,
            itemOpts,
          );
          delete (item as any)[field];
        }
      }
    });
  if (Object.keys(output).length === 0) return undefined;
  return output;
}

export function fillNumbering(base?: Numbering, filler?: Numbering) {
  const output: Numbering = { ...filler, ...base };
  Object.entries(filler ?? {})
    .filter(([key]) => !NUMBERING_OPTIONS.includes(key))
    .forEach(([key, val]) => {
      output[key] = fillMissingKeys(
        base?.[key] ?? {},
        // Enabling/disabling all in base overrides filler
        {
          ...val,
          enabled: base?.all?.enabled ?? val.enabled,
          continue: base?.all?.continue ?? val.continue,
        },
        NUMBERING_ITEM_KEYS,
      );
    });
  return output;
}
