import { describe, expect, test } from 'vitest';
import {
  addChildrenFromTargetNode,
  MultiPageReferenceResolver,
  ReferenceState,
  enumerateTargetsTransform,
  formatCounter,
  formatHeadingEnumerator,
  incrementHeadingCounts,
  initializeTargetCounts,
} from './enumerate';
import { u } from 'unist-builder';
import { VFile } from 'vfile';
import { toText } from 'myst-common';

describe('formatCounter', () => {
  test.each([
    [1, undefined, '1'],
    [1, 'arabic', '1'],
    [27, 'arabic', '27'],
    [1, 'alph', 'a'],
    [26, 'alph', 'z'],
    [27, 'alph', 'aa'],
    [28, 'alph', 'ab'],
    [52, 'alph', 'az'],
    [53, 'alph', 'ba'],
    [1, 'Alph', 'A'],
    [27, 'Alph', 'AA'],
    [1, 'roman', 'i'],
    [4, 'roman', 'iv'],
    [9, 'roman', 'ix'],
    [40, 'roman', 'xl'],
    [90, 'roman', 'xc'],
    [400, 'roman', 'cd'],
    [900, 'roman', 'cm'],
    [1994, 'roman', 'mcmxciv'],
    [1, 'Roman', 'I'],
    [4, 'Roman', 'IV'],
    [1994, 'Roman', 'MCMXCIV'],
    [0, 'Alph', '0'], // non-positive passes through
    [-1, 'Roman', '-1'],
  ] as const)('formatCounter(%s, %s) → %s', (n, fmt, expected) => {
    expect(formatCounter(n as number, fmt as any)).toBe(expected);
  });
});

describe('formatHeadingEnumerator with formats', () => {
  test('Alph at depth 1 renders as letter', () => {
    expect(formatHeadingEnumerator([1, 0, 0, 0, 0, 0], undefined, ['Alph'])).toBe('A');
  });
  test('Alph chapter prefix on a sub-heading', () => {
    expect(formatHeadingEnumerator([2, 3, 0, 0, 0, 0], undefined, ['Alph'])).toBe('B.3');
  });
  test('Roman at depth 1, arabic sub-headings', () => {
    expect(formatHeadingEnumerator([3, 2, 1, 0, 0, 0], undefined, ['Roman'])).toBe('III.2.1');
  });
  test("no formats array preserves today's arabic behaviour", () => {
    expect(formatHeadingEnumerator([1, 2, 0, 0, 0, 0])).toBe('1.2');
  });
});

describe('Heading counts and formatting', () => {
  test.each([
    [2, [0, 0, 0, null, 0, 0], [0, 1, 0, null, 0, 0]],
    [1, [0, 1, 0, null, 0, 0], [1, 0, 0, null, 0, 0]],
    [2, [1, 0, 0, null, 0, 0], [1, 1, 0, null, 0, 0]],
    [5, [1, 1, 0, null, 0, 0], [1, 1, 0, null, 1, 0]],
    [5, [1, 1, 0, null, 1, 0], [1, 1, 0, null, 2, 0]],
    [2, [1, 1, 0, null, 2, 0], [1, 2, 0, null, 0, 0]],
    [1, [1, 2, 0, null, 0, 0], [2, 0, 0, null, 0, 0]],
  ])('incrementHeadingCounts(%s, %s)}', (depth, counts, out) => {
    expect(incrementHeadingCounts(depth, counts)).toEqual(out);
  });
  test.each([
    [[0, 0, 0, null, 0, 0], ''],
    [[0, 1, 0, null, 0, 0], '0.1'],
    [[1, 0, 0, null, 0, 0], '1'],
    [[1, 1, 0, null, 0, 0], '1.1'],
    [[1, 1, 0, null, 1, 0], '1.1.0.1'],
    [[1, 1, 0, null, 2, 0], '1.1.0.2'],
    [[1, 2, 0, null, 0, 0], '1.2'],
  ])('formatHeadingEnumerator(%s)}', (counts, out) => {
    expect(formatHeadingEnumerator(counts)).toEqual(out);
  });
});

describe('enumeration', () => {
  test('figure enumerators', () => {
    const tree = u('root', [
      u('heading', { identifier: 'ha', depth: 2 }),
      u('heading', { identifier: 'hb', depth: 3 }),
      u('heading', { identifier: 'hc', depth: 3 }),
      u('container', { kind: 'figure', identifier: 'fig1' }),
    ]);
    const state = new ReferenceState('my-file.md', {
      frontmatter: {
        numbering: {
          heading_1: { enabled: true },
          heading_2: { enabled: true },
          figure: { enumerator: 'FancyTemplateSoon.%s' },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('fig1')?.node.enumerator).toBe('FancyTemplateSoon.1');
  });
  test('sub-equations', () => {
    const tree = u('root', [
      u('mathGroup', { identifier: 'eq:1' }, [
        u('math', { identifier: 'eq:1a', kind: 'subequation' }),
        u('math', { identifier: 'eq:1b', kind: 'subequation' }),
      ]),
      u('math', { identifier: 'eq:x', enumerated: false }),
      u('math', { identifier: 'eq:2' }),
      u('mathGroup', { identifier: 'eq:3' }, [
        u('math', { identifier: 'eq:3-1', kind: 'subequation', enumerated: false }),
        u('math', { identifier: 'eq:3-2', kind: 'subequation' }),
        u('math', { identifier: 'eq:3-3', kind: 'subequation', enumerated: false }),
        u('math', { identifier: 'eq:3-4', kind: 'subequation' }),
      ]),
    ]);
    const state = new ReferenceState('my-file.md', {
      frontmatter: { numbering: { enumerator: { enumerator: 'A.%s' } } },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('eq:1')?.node.enumerator).toBe('A.1');
    expect(state.getTarget('eq:1a')?.node.enumerator).toBe('A.1a');
    expect(state.getTarget('eq:1b')?.node.enumerator).toBe('A.1b');
    expect(state.getTarget('eq:x')?.node.enumerator).toBeUndefined();
    expect(state.getTarget('eq:2')?.node.enumerator).toBe('A.2');
    expect(state.getTarget('eq:3')?.node.enumerator).toBe('A.3');
    expect(state.getTarget('eq:3-1')?.node.enumerator).toBeUndefined();
    expect(state.getTarget('eq:3-2')?.node.enumerator).toBe('A.3a');
    expect(state.getTarget('eq:3-3')?.node.enumerator).toBeUndefined();
    expect(state.getTarget('eq:3-4')?.node.enumerator).toBe('A.3b');
  });
  test('headers', () => {
    const tree = u('root', [
      u('heading', { identifier: 'h1', depth: 2 }),
      u('heading', { identifier: 'h2', depth: 3 }),
      u('heading', { identifier: 'h3', depth: 2 }),
    ]);
    const state = new ReferenceState('my-file.md', {
      frontmatter: { numbering: { heading_1: { enabled: true }, heading_2: { enabled: true } } },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('h1')?.node.enumerator).toBe('1');
    expect(state.getTarget('h2')?.node.enumerator).toBe('1.1');
    expect(state.getTarget('h3')?.node.enumerator).toBe('2');
  });
  test('sub-figures', () => {
    const tree = u('root', [
      u('container', { identifier: 'fig:1', kind: 'figure' }, [
        u('container', { identifier: 'fig:1a', kind: 'figure', subcontainer: true }),
        u('container', { identifier: 'fig:1b', kind: 'figure', subcontainer: true }),
        u('container', { kind: 'figure', subcontainer: true }),
      ]),
      u('container', { identifier: 'fig:2', kind: 'figure' }, []),
    ]);
    const state = new ReferenceState('my-file.md', {
      frontmatter: { numbering: { enumerator: { enumerator: 'A.%s' } } },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('fig:1')?.node.enumerator).toBe('A.1');
    expect(state.getTarget('fig:1a')?.node.enumerator).toBe('a');
    expect(state.getTarget('fig:1a')?.node.parentEnumerator).toBe('A.1');
    expect(state.getTarget('fig:1b')?.node.enumerator).toBe('b');
    expect(state.getTarget('fig:1b')?.node.parentEnumerator).toBe('A.1');
    expect(state.getTarget('fig:1-c')?.node.enumerator).toBe('c');
    expect(state.getTarget('fig:1-c')?.node.parentEnumerator).toBe('A.1');
    expect(state.getTarget('fig:2')?.node.enumerator).toBe('A.2');
  });
});
describe('Book-mode auto-prefix (§3.4(6,7))', () => {
  test('figure picks up chapter prefix when book mode is on', () => {
    const tree = u('root', [
      u('container', { kind: 'figure', identifier: 'fig1' }),
      u('container', { kind: 'figure', identifier: 'fig2' }),
    ]);
    const state = new ReferenceState('ch1.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true, label: 'Chapter %s' },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.enumerator).toBe('1');
    expect(state.getTarget('fig1')?.node.enumerator).toBe('1.1');
    expect(state.getTarget('fig2')?.node.enumerator).toBe('1.2');
  });

  test('appendix Alph prefix flows to figures', () => {
    const tree = u('root', [u('container', { kind: 'figure', identifier: 'fa' })]);
    const state = new ReferenceState('app-a.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true, format: 'Alph', label: 'Appendix %s' },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.enumerator).toBe('A');
    expect(state.getTarget('fa')?.node.enumerator).toBe('A.1');
  });

  test('continue: true opts out of prefix and keeps counter flat', () => {
    const tree = u('root', [u('container', { kind: 'figure', identifier: 'figc' })]);
    const state = new ReferenceState('ch1.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true },
          figure: { continue: true },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('figc')?.node.enumerator).toBe('1');
  });

  test('no auto-prefix when book mode is off', () => {
    const tree = u('root', [u('container', { kind: 'figure', identifier: 'fx' })]);
    const state = new ReferenceState('p.md', {
      frontmatter: {
        numbering: {
          // book flag not set → today's behaviour preserved
          title: { enabled: true },
          heading_1: { enabled: true },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('fx')?.node.enumerator).toBe('1');
  });

  test('unnumbered page (no enumerator) → no prefix even in book mode', () => {
    // mimics a frontmatter/backmatter page where heading_1.enabled is false
    const tree = u('root', [u('container', { kind: 'figure', identifier: 'fz' })]);
    const state = new ReferenceState('preface.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: false },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.enumerator).toBeUndefined();
    expect(state.getTarget('fz')?.node.enumerator).toBe('1');
  });

  test('equation and table also pick up the prefix', () => {
    const tree = u('root', [
      u('math', { identifier: 'eq1' }),
      u('container', { kind: 'table', identifier: 't1' }),
    ]);
    const state = new ReferenceState('ch1.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('eq1')?.node.enumerator).toBe('1.1');
    expect(state.getTarget('t1')?.node.enumerator).toBe('1.1');
  });

  test('proof:* and exercise pick up the chapter prefix', () => {
    // §3.5(6): the auto-prefix matcher uses a `proof:` prefix test so any
    // proof-family kind (theorem/lemma/proposition/…) and exercise pick up
    // the chapter prefix without each kind needing to be enumerated.
    const tree = u('root', [
      u('proof', { kind: 'theorem', identifier: 'thm:1' }),
      u('proof', { kind: 'lemma', identifier: 'lem:1' }),
      u('exercise', { identifier: 'ex:1', enumerated: true }),
    ]);
    const state = new ReferenceState('ch3.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          all: { enabled: true }, // enable every kind incl. proof:*/exercise
          title: { enabled: true },
          heading_1: { enabled: true, start: 3 },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.enumerator).toBe('3');
    expect(state.getTarget('thm:1')?.node.enumerator).toBe('3.1');
    expect(state.getTarget('lem:1')?.node.enumerator).toBe('3.1');
    // Each proof-family kind keeps its own counter — theorem and lemma both
    // start at 3.1 in the same chapter; only the chapter prefix is shared.
    expect(state.getTarget('ex:1')?.node.enumerator).toBe('3.1');
  });

  test('page-level format override is render-only (§3.4(9))', () => {
    // A chapter page sets `format: Roman` in its frontmatter. Only that
    // page's rendered enumerator changes; the underlying counter
    // sequence stays 1, 2, 3, 4 so siblings render arithmetic-naturally.
    // Modelled here via the `previousCounts` chain across three pages.
    const ch1 = new ReferenceState('ch1.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true, label: 'Chapter %s' },
        },
      },
      vfile: new VFile(),
    });
    expect(ch1.enumerator).toBe('1');

    const ch2 = new ReferenceState('ch2.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          title: { enabled: true },
          // page-level override flips this chapter's rendering only
          heading_1: { enabled: true, label: 'Chapter %s', format: 'Roman' },
        },
      },
      previousCounts: ch1.targetCounts,
      vfile: new VFile(),
    });
    expect(ch2.enumerator).toBe('II'); // rendered as Roman
    // The underlying count is still 2 (not converted) — confirm by reading
    // targetCounts.heading[0] directly. The Roman is purely a render
    // detail at formatHeadingEnumerator time.
    expect(ch2.targetCounts.heading[0]).toBe(2);

    const ch3 = new ReferenceState('ch3.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true, label: 'Chapter %s' },
        },
      },
      previousCounts: ch2.targetCounts,
      vfile: new VFile(),
    });
    // ch3 picks up where ch2 left off arithmetically — "3", not "4" — so
    // the page-level Roman override did not disturb the sequence.
    expect(ch3.enumerator).toBe('3');
  });

  // ---------------------------------------------------------------------
  // #27: section-scoped auto-prefix (LaTeX `\newtheorem{...}[section]`).
  // ---------------------------------------------------------------------

  test('proof:* picks up section prefix when scope=section (#27)', () => {
    // chapter 1 with two sections; each section has two theorems.
    // Expected: 1.1.1, 1.1.2, 1.2.1, 1.2.2 (LaTeX `[section]` parity).
    const tree = u('root', [
      u('heading', { identifier: 's1', depth: 2 }),
      u('proof', { kind: 'theorem', identifier: 'thm:1' }),
      u('proof', { kind: 'theorem', identifier: 'thm:2' }),
      u('heading', { identifier: 's2', depth: 2 }),
      u('proof', { kind: 'theorem', identifier: 'thm:3' }),
      u('proof', { kind: 'theorem', identifier: 'thm:4' }),
    ]);
    const state = new ReferenceState('ch1.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          all: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true },
          heading_2: { enabled: true },
          proof: { scope: 'section' },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('thm:1')?.node.enumerator).toBe('1.1.1');
    expect(state.getTarget('thm:2')?.node.enumerator).toBe('1.1.2');
    expect(state.getTarget('thm:3')?.node.enumerator).toBe('1.2.1');
    expect(state.getTarget('thm:4')?.node.enumerator).toBe('1.2.2');
  });

  test('per-kind scope wins over proof umbrella (#27)', () => {
    // umbrella sets section-scoped for all proofs, but lemma overrides
    // back to chapter scope — theorem stays section-scoped.
    const tree = u('root', [
      u('heading', { identifier: 's1', depth: 2 }),
      u('proof', { kind: 'theorem', identifier: 'thm:1' }),
      u('proof', { kind: 'lemma', identifier: 'lem:1' }),
      u('heading', { identifier: 's2', depth: 2 }),
      u('proof', { kind: 'theorem', identifier: 'thm:2' }),
      u('proof', { kind: 'lemma', identifier: 'lem:2' }),
    ]);
    const state = new ReferenceState('ch1.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          all: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true },
          heading_2: { enabled: true },
          proof: { scope: 'section' },
          'proof:lemma': { scope: 'chapter' },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('thm:1')?.node.enumerator).toBe('1.1.1');
    expect(state.getTarget('thm:2')?.node.enumerator).toBe('1.2.1');
    // lemma keeps the chapter-only prefix and counter doesn't reset
    expect(state.getTarget('lem:1')?.node.enumerator).toBe('1.1');
    expect(state.getTarget('lem:2')?.node.enumerator).toBe('1.2');
  });

  test('proof:* before first heading_2 renders literal 5.0.1 (#27)', () => {
    // LaTeX `\newtheorem{theorem}[section]` literally prints section=0
    // when no section has been started yet. Match the PDF: render as
    // `5.0.1`, not the trailing-zero-stripped `5.1` (which would also
    // collide with later `5.1.x` numbers).
    const tree = u('root', [
      u('proof', { kind: 'theorem', identifier: 'thm:pre' }),
      u('heading', { identifier: 's1', depth: 2 }),
      u('proof', { kind: 'theorem', identifier: 'thm:post' }),
    ]);
    const state = new ReferenceState('ch5.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          all: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true, start: 5 },
          heading_2: { enabled: true },
          proof: { scope: 'section' },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('thm:pre')?.node.enumerator).toBe('5.0.1');
    expect(state.getTarget('thm:post')?.node.enumerator).toBe('5.1.1');
  });

  test('section scope under an appendix uses Alph chapter (#27)', () => {
    // appendix A: heading_1 format=Alph; heading_2 stays arabic.
    // Expected `A.1.1`, `A.1.2` for two theorems in §A.1.
    const tree = u('root', [
      u('heading', { identifier: 'sa', depth: 2 }),
      u('proof', { kind: 'theorem', identifier: 'thm:a1' }),
      u('proof', { kind: 'theorem', identifier: 'thm:a2' }),
    ]);
    const state = new ReferenceState('app-a.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          all: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true, format: 'Alph' },
          heading_2: { enabled: true },
          proof: { scope: 'section' },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.enumerator).toBe('A');
    expect(state.getTarget('thm:a1')?.node.enumerator).toBe('A.1.1');
    expect(state.getTarget('thm:a2')?.node.enumerator).toBe('A.1.2');
  });

  test('scope accepts heading_2 alias (#27)', () => {
    const tree = u('root', [
      u('heading', { identifier: 's1', depth: 2 }),
      u('proof', { kind: 'theorem', identifier: 'thm:1' }),
    ]);
    const state = new ReferenceState('ch1.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          all: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true },
          heading_2: { enabled: true },
          'proof:theorem': { scope: 'heading_2' },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('thm:1')?.node.enumerator).toBe('1.1.1');
  });

  test('scope=subsection (heading_3) prefixes with chapter.section.subsection (#27)', () => {
    const tree = u('root', [
      u('heading', { identifier: 's1', depth: 2 }),
      u('heading', { identifier: 'ss1', depth: 3 }),
      u('proof', { kind: 'theorem', identifier: 'thm:1' }),
      u('proof', { kind: 'theorem', identifier: 'thm:2' }),
      u('heading', { identifier: 'ss2', depth: 3 }),
      u('proof', { kind: 'theorem', identifier: 'thm:3' }),
    ]);
    const state = new ReferenceState('ch1.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          all: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true },
          heading_2: { enabled: true },
          heading_3: { enabled: true },
          proof: { scope: 'subsection' },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('thm:1')?.node.enumerator).toBe('1.1.1.1');
    expect(state.getTarget('thm:2')?.node.enumerator).toBe('1.1.1.2');
    // counter resets on heading_3 boundary, not heading_2
    expect(state.getTarget('thm:3')?.node.enumerator).toBe('1.1.2.1');
  });

  test('continue: true on a kind still wins over scope (#27)', () => {
    // `continue: true` keeps the counter globally flat and drops the
    // prefix entirely, even when scope is set. Matches §3.4(6) opt-out.
    const tree = u('root', [
      u('heading', { identifier: 's1', depth: 2 }),
      u('proof', { kind: 'theorem', identifier: 'thm:1' }),
      u('proof', { kind: 'theorem', identifier: 'thm:2' }),
    ]);
    const state = new ReferenceState('ch1.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          all: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true },
          heading_2: { enabled: true },
          'proof:theorem': { scope: 'section', continue: true },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('thm:1')?.node.enumerator).toBe('1');
    expect(state.getTarget('thm:2')?.node.enumerator).toBe('2');
  });

  test('figures also accept scope (#27)', () => {
    // Confirms scope generalises to every auto-prefix kind, not just
    // proof:* — `numbering.all.scope` applies to figure too.
    const tree = u('root', [
      u('heading', { identifier: 's1', depth: 2 }),
      u('container', { kind: 'figure', identifier: 'fig:1' }),
      u('heading', { identifier: 's2', depth: 2 }),
      u('container', { kind: 'figure', identifier: 'fig:2' }),
    ]);
    const state = new ReferenceState('ch3.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          all: { enabled: true, scope: 'section' },
          title: { enabled: true },
          heading_1: { enabled: true, start: 3 },
          heading_2: { enabled: true },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('fig:1')?.node.enumerator).toBe('3.1.1');
    expect(state.getTarget('fig:2')?.node.enumerator).toBe('3.2.1');
  });

  test('subfigures inherit the chapter-prefixed parent enumerator', () => {
    const tree = u('root', [
      u('container', { kind: 'figure', identifier: 'fig-p' }, [
        u('container', { kind: 'figure', subcontainer: true, identifier: 'fig-p-a' }),
        u('container', { kind: 'figure', subcontainer: true, identifier: 'fig-p-b' }),
      ]),
    ]);
    const state = new ReferenceState('ch2.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true, start: 2 },
        },
      },
      vfile: new VFile(),
    });
    enumerateTargetsTransform(tree, { state });
    expect(state.enumerator).toBe('2');
    expect(state.getTarget('fig-p')?.node.enumerator).toBe('2.1');
    expect(state.getTarget('fig-p-a')?.node.parentEnumerator).toBe('2.1');
  });
});

describe('Heading cross-ref rendering (§3.2(h))', () => {
  test('label takes precedence over template for numbered heading', () => {
    const heading = u(
      'heading',
      {
        identifier: 'ch1',
        depth: 1,
        enumerator: '1',
      },
      [u('text', 'Introduction')],
    );
    const ref: any = { type: 'crossReference', identifier: 'ch1' };
    addChildrenFromTargetNode(
      ref,
      heading as any,
      {
        title: { enabled: true },
        heading_1: { enabled: true, template: 'Section %s', label: 'Chapter %s' },
      },
      new VFile(),
    );
    expect(toText(ref.children)).toBe('Chapter 1');
  });

  test('falls back to template when label is absent', () => {
    const heading = u(
      'heading',
      {
        identifier: 'h1',
        depth: 1,
        enumerator: '1',
      },
      [u('text', 'Introduction')],
    );
    const ref: any = { type: 'crossReference', identifier: 'h1' };
    addChildrenFromTargetNode(
      ref,
      heading as any,
      {
        title: { enabled: true },
        heading_1: { enabled: true, template: 'Section %s' },
      },
      new VFile(),
    );
    expect(toText(ref.children)).toBe('Section 1');
  });

  test('unnumbered heading falls back to title (#12 fix)', () => {
    // Heading has no enumerator — even though numbering.heading_1 has a
    // template, the cross-ref must render the heading text, not
    // "Chapter ??".
    const heading = u('heading', { identifier: 'preface', depth: 1 }, [u('text', 'Preface')]);
    const ref: any = { type: 'crossReference', identifier: 'preface' };
    addChildrenFromTargetNode(
      ref,
      heading as any,
      {
        title: { enabled: true },
        heading_1: { enabled: true, template: 'Chapter %s', label: 'Chapter %s' },
      },
      new VFile(),
    );
    expect(toText(ref.children)).toBe('Preface');
  });

  test('explicit link text wins', () => {
    const heading = u(
      'heading',
      {
        identifier: 'ch1',
        depth: 1,
        enumerator: '1',
      },
      [u('text', 'Introduction')],
    );
    const ref: any = {
      type: 'crossReference',
      identifier: 'ch1',
      children: [u('text', 'the intro')],
    };
    addChildrenFromTargetNode(
      ref,
      heading as any,
      {
        title: { enabled: true },
        heading_1: { enabled: true, label: 'Chapter %s' },
      },
      new VFile(),
    );
    expect(toText(ref.children)).toBe('the intro');
  });

  test('label with Alph-formatted enumerator (appendix-style)', () => {
    const heading = u(
      'heading',
      {
        identifier: 'app-a',
        depth: 1,
        enumerator: 'A',
      },
      [u('text', 'Proofs')],
    );
    const ref: any = { type: 'crossReference', identifier: 'app-a' };
    addChildrenFromTargetNode(
      ref,
      heading as any,
      {
        title: { enabled: true },
        heading_1: { enabled: true, label: 'Appendix %s' },
      },
      new VFile(),
    );
    expect(toText(ref.children)).toBe('Appendix A');
  });

  test('file-target on nested page uses heading_${offset+1}, not heading_1', () => {
    // Copilot review #1: a nested TOC page has offset>0; its title
    // enumerator was generated at heading_${offset+1}. The file-target
    // label rendering must read the same depth, otherwise a sub-section
    // under a book chapter renders as "Chapter 1.1" (using heading_1's
    // book label) instead of "Section 1.1".
    const filePage = new ReferenceState('nested.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          title: { enabled: true, offset: 1 },
          heading_1: { enabled: true, label: 'Chapter %s' },
          heading_2: { enabled: true, label: 'Section %s' },
        },
      },
      identifiers: ['nested-page'],
      vfile: new VFile(),
    });
    filePage.url = '/nested';
    // Force a deterministic enumerator (mimicking previousCounts having
    // already filled heading_1 = 1 from the parent chapter, so the
    // sub-page becomes heading_2 == 1 → "1.1").
    filePage.enumerator = '1.1';
    const resolver = new MultiPageReferenceResolver([filePage], 'caller.md');
    const ref: any = { type: 'crossReference', identifier: 'nested-page' };
    resolver.resolveReferenceContent(ref);
    expect(toText(ref.children)).toBe('Section 1.1');
  });
});

describe('Book-mode auto-prefix for figures and equations (§3.2(e))', () => {
  function pageState(opts: { enumerator?: string; book?: boolean; figureContinue?: boolean }) {
    return new ReferenceState('p.md', {
      frontmatter: {
        numbering: {
          ...(opts.book ? { book: { enabled: true } } : {}),
          title: { enabled: true },
          heading_1: { enabled: true },
          figure: {
            enabled: true,
            ...(opts.figureContinue ? { continue: true } : {}),
          },
        },
        // Force the constructor to NOT auto-enumerate the title, so we can
        // set this.enumerator explicitly for the test.
        content_includes_title: true,
      } as any,
      vfile: new VFile(),
    });
  }

  test('book mode prefixes figure with page enumerator', () => {
    const state = pageState({ book: true });
    (state as any).enumerator = '3';
    const tree = u('root', [
      u('container', { kind: 'figure', identifier: 'f1' }),
      u('container', { kind: 'figure', identifier: 'f2' }),
    ]);
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('f1')?.node.enumerator).toBe('3.1');
    expect(state.getTarget('f2')?.node.enumerator).toBe('3.2');
  });

  test('appendix-style Alph enumerator prefixes correctly', () => {
    const state = pageState({ book: true });
    (state as any).enumerator = 'A';
    const tree = u('root', [
      u('container', { kind: 'figure', identifier: 'fA1' }),
      u('container', { kind: 'figure', identifier: 'fA2' }),
    ]);
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('fA1')?.node.enumerator).toBe('A.1');
    expect(state.getTarget('fA2')?.node.enumerator).toBe('A.2');
  });

  test("no book mode → no prefix (today's behavior preserved)", () => {
    const state = pageState({ book: false });
    (state as any).enumerator = '3';
    const tree = u('root', [u('container', { kind: 'figure', identifier: 'f1' })]);
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('f1')?.node.enumerator).toBe('1');
  });

  test('figure.continue: true opts out of prefix (flat counter)', () => {
    const state = pageState({ book: true, figureContinue: true });
    (state as any).enumerator = '3';
    const tree = u('root', [u('container', { kind: 'figure', identifier: 'f1' })]);
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('f1')?.node.enumerator).toBe('1');
  });

  test('frontmatter page (no enumerator) keeps flat global counter', () => {
    const state = pageState({ book: true });
    // no this.enumerator set
    const tree = u('root', [u('container', { kind: 'figure', identifier: 'f1' })]);
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('f1')?.node.enumerator).toBe('1');
  });

  test('book mode prefixes proof:theorem and exercise', () => {
    const state = new ReferenceState('p.md', {
      frontmatter: {
        numbering: {
          book: { enabled: true },
          title: { enabled: true },
          heading_1: { enabled: true },
          'proof:theorem': { enabled: true },
          exercise: { enabled: true },
        },
        content_includes_title: true,
      } as any,
      vfile: new VFile(),
    });
    (state as any).enumerator = '6';
    const tree = u('root', [
      u('proof', { kind: 'theorem', identifier: 'thm1' }),
      u('exercise', { identifier: 'ex1' }),
    ]);
    enumerateTargetsTransform(tree, { state });
    expect(state.getTarget('thm1')?.node.enumerator).toBe('6.1');
    expect(state.getTarget('ex1')?.node.enumerator).toBe('6.1');
  });
});

describe('initializeTargetCounts', () => {
  test('no inputs initializes heading', () => {
    expect(initializeTargetCounts({})).toEqual({ heading: [0, 0, 0, 0, 0, 0] });
  });
  test('previousCounts unchanged if continue is true', () => {
    const initialCounts = {
      heading: [5, 3, 1, 0, null, null],
      figure: { main: 7, sub: 2 },
      other: { main: 0, sub: 0 },
    };
    expect(
      initializeTargetCounts({ all: { continue: true, enabled: true } }, initialCounts as any),
    ).toEqual(initialCounts);
  });
  test('numbering starts are respected', () => {
    const numbering = {
      heading_1: { enabled: true, start: 5 },
      heading_2: { enabled: false, start: 2 },
      heading_5: { enabled: true, start: 2 },
      figure: { enabled: true, start: 5 },
      other: { enabled: true, start: 8 },
    };
    expect(initializeTargetCounts(numbering)).toEqual({
      heading: [4, null, 0, 0, 1, 0],
      figure: { main: 4, sub: 0 },
      other: { main: 7, sub: 0 },
    });
  });
  test('previousCounts override are prioritized', () => {
    const previousCounts = {
      heading: [5, 3, 1, 0, null, null],
      figure: { main: 7, sub: 2 },
      other: { main: 3, sub: 0 },
    };
    expect(
      initializeTargetCounts(
        {
          heading_1: { continue: true, enabled: true },
          heading_2: { continue: true, enabled: true },
          heading_3: { continue: true, enabled: true },
          heading_4: { continue: true, enabled: true },
          heading_5: { continue: true, enabled: true },
          heading_6: { continue: true, enabled: true },
          figure: { continue: true, enabled: true },
          other: { continue: true, enabled: true },
        },
        previousCounts as any,
      ),
    ).toEqual(previousCounts);
  });
  test('explicit numberings override previous', () => {
    const previousCounts = {
      heading: [5, 3, 1, 0, null, null],
      figure: { main: 7, sub: 2 },
    };
    const numbering = {
      heading_1: { enabled: true, start: 5, continue: true },
      heading_2: { enabled: false, start: 2, continue: true },
      heading_5: { enabled: true, start: 2, continue: true },
      figure: { enabled: true, start: 5, continue: true },
      code: { enabled: true, start: 8, continue: true },
    };
    expect(initializeTargetCounts(numbering, previousCounts as any)).toEqual({
      heading: [4, null, 0, 0, 1, 0],
      figure: { main: 4, sub: 0 },
      code: { main: 7, sub: 0 },
    });
  });
  test('unknown numberings reset from previousCounts', () => {
    const previousCounts = {
      heading: [5, 3, 1, 0, null, null],
      figure: { main: 7, sub: 2 },
      exercise: { main: 5, sub: 0 },
    };
    const numbering = {
      heading_1: { enabled: true, start: 5, continue: true },
      heading_2: { enabled: false, start: 2, continue: true },
      heading_5: { enabled: true, start: 2, continue: true },
      figure: { enabled: true, start: 5, continue: true },
    };
    expect(initializeTargetCounts(numbering, previousCounts as any)).toEqual({
      heading: [4, null, 0, 0, 1, 0],
      figure: { main: 4, sub: 0 },
    });
  });
});
