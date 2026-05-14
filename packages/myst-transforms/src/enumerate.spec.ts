import { describe, expect, test } from 'vitest';
import {
  addChildrenFromTargetNode,
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
  test('no formats array preserves today\'s arabic behaviour', () => {
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
describe('Heading cross-ref rendering (§3.2(h))', () => {
  test('label takes precedence over template for numbered heading', () => {
    const heading = u('heading', {
      identifier: 'ch1',
      depth: 1,
      enumerator: '1',
    }, [u('text', 'Introduction')]);
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
    const heading = u('heading', {
      identifier: 'h1',
      depth: 1,
      enumerator: '1',
    }, [u('text', 'Introduction')]);
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
    const heading = u('heading', {
      identifier: 'ch1',
      depth: 1,
      enumerator: '1',
    }, [u('text', 'Introduction')]);
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
    const heading = u('heading', {
      identifier: 'app-a',
      depth: 1,
      enumerator: 'A',
    }, [u('text', 'Proofs')]);
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
