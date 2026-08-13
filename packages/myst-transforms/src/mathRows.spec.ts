import { describe, expect, test } from 'vitest';
import { u } from 'unist-builder';
import { VFile } from 'vfile';
import { scanMathRows, buildRowTex } from './mathRows';
import { mathLabelTransform, mathTransform, renderRowNumberedMathTransform } from './math';
import { ReferenceState, enumerateTargetsTransform } from './enumerate';

describe('scanMathRows', () => {
  test('splits a two-row align', () => {
    const scan = scanMathRows('\\begin{align}a &= b \\\\ c &= d\\end{align}');
    expect(scan).toBeDefined();
    expect(scan?.env).toBe('align');
    expect(scan?.starred).toBeUndefined();
    expect(scan?.rows.map((r) => r.tex.trim())).toEqual(['a &= b', 'c &= d']);
    expect(scan?.rows[0].sep).toBe('\\\\');
  });
  test('starred align is marked starred', () => {
    const scan = scanMathRows('\\begin{align*}a &= b \\\\ c &= d\\end{align*}');
    expect(scan?.starred).toBe(true);
  });
  test('does not split on \\\\ inside nested cases', () => {
    const scan = scanMathRows(
      '\\begin{align}f(x) &= \\begin{cases} 1 \\\\ 0 \\end{cases} \\\\ g &= h\\end{align}',
    );
    expect(scan?.rows).toHaveLength(2);
    expect(scan?.rows[0].tex).toContain('cases');
  });
  test('does not split on \\\\ inside a brace group', () => {
    const scan = scanMathRows('\\begin{align}a &= \\text{x \\\\ y} \\\\ c &= d\\end{align}');
    expect(scan?.rows).toHaveLength(2);
  });
  test('handles \\\\* and \\\\[len] separators', () => {
    const scan = scanMathRows('\\begin{align}a &= b \\\\* c &= d \\\\[2em] e &= f\\end{align}');
    expect(scan?.rows).toHaveLength(3);
    expect(scan?.rows[0].sep).toBe('\\\\*');
    expect(scan?.rows[1].sep).toBe('\\\\[2em]');
  });
  test('extracts per-row labels, nonumber, and tags', () => {
    const scan = scanMathRows(
      '\\begin{align}x &= y \\label{eq-xy} \\\\ u &= v \\nonumber \\\\ w &= z \\tag{A1}\\end{align}',
    );
    expect(scan?.labelsStripped).toBe(true);
    expect(scan?.rows[0].labels).toEqual(['eq-xy']);
    expect(scan?.rows[0].tex).not.toContain('\\label');
    expect(scan?.rows[1].nonumber).toBe(true);
    expect(scan?.rows[2].tag).toBe('A1');
  });
  test('captures the alignat argument', () => {
    const scan = scanMathRows('\\begin{alignat}{2}a &= b \\\\ c &= d\\end{alignat}');
    expect(scan?.env).toBe('alignat');
    expect(scan?.envArg).toBe('{2}');
    expect(scan?.rows).toHaveLength(2);
  });
  test('drops a whitespace-only trailing row', () => {
    const scan = scanMathRows('\\begin{align}a &= b \\\\ c &= d \\\\\n\\end{align}');
    expect(scan?.rows).toHaveLength(2);
    expect(scan?.rows[1].sep).toBeUndefined();
  });
  test('returns undefined for non-row environments', () => {
    expect(scanMathRows('\\begin{equation}a = b\\end{equation}')).toBeUndefined();
    expect(scanMathRows('\\begin{aligned}a &= b \\\\ c &= d\\end{aligned}')).toBeUndefined();
    expect(scanMathRows('a = b')).toBeUndefined();
  });
  test('returns undefined for unbalanced bodies', () => {
    expect(scanMathRows('\\begin{align}a &= { b \\\\ c\\end{align}')).toBeUndefined();
  });
});

describe('buildRowTex', () => {
  const info = {
    env: 'align' as const,
    rows: [
      { tex: 'a &= b', sep: '\\\\', enumerator: '1.1' },
      { tex: 'c &= d \\nonumber', sep: '\\\\', nonumber: true },
      { tex: 'e &= f', enumerator: '1.2', label: 'eq-f' },
    ],
  };
  test('injects tags for enumerated rows in the starred env', () => {
    const tex = buildRowTex(info, { starred: true, injectTags: true });
    expect(tex).toContain('\\begin{align*}');
    expect(tex).toContain('a &= b \\tag{1.1}');
    expect(tex).toContain('c &= d \\nonumber');
    expect(tex).not.toContain('\\nonumber \\tag');
    expect(tex).toContain('e &= f \\tag{1.2}');
  });
  test('re-injects labels for LaTeX export shape', () => {
    const tex = buildRowTex(info, { injectLabels: true });
    expect(tex).toContain('\\begin{align}');
    expect(tex).toContain('e &= f \\label{eq-f}');
    expect(tex).not.toContain('\\tag{1.1}');
  });
});

function pageWithMath(values: string[]) {
  return u(
    'root',
    values.map((value) => u('math', { value }) as any),
  ) as any;
}

const BOOK_NUMBERING = {
  frontmatter: {
    numbering: {
      book: { enabled: true },
      title: { enabled: true },
    },
  } as any,
};

describe('per-row numbering end to end', () => {
  test('align rows are numbered individually; nonumber skipped; labels resolve per row', () => {
    const file = new VFile();
    const tree = pageWithMath([
      '\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}',
      '\\begin{align}\nx &= y \\label{eq-xy} \\\\\nu &= v \\nonumber \\\\\nw &= z \\label{eq-wz}\n\\end{align}',
      '\\begin{equation}\nq = r\n\\end{equation}',
    ]);
    mathLabelTransform(tree, file);
    const [first, second, third] = tree.children as any[];
    expect(first.rows.rows).toHaveLength(2);
    expect(second.rows.rows).toHaveLength(3);
    expect(second.value).not.toContain('\\label');
    expect(third.rows).toBeUndefined();

    const state = new ReferenceState('page.md', { vfile: file, frontmatter: {} as any });
    enumerateTargetsTransform(tree, { state });
    expect(first.rows.rows.map((r: any) => r.enumerator)).toEqual(['1', '2']);
    expect(first.enumerator).toBeUndefined();
    expect(second.rows.rows.map((r: any) => r.enumerator)).toEqual(['3', undefined, '4']);
    // The block after the aligns continues the counter where amsmath would
    expect(third.enumerator).toBe('5');
    // Row labels resolve to the row's number and anchor to the block
    expect(state.getTarget('eq-xy')?.node.enumerator).toBe('3');
    expect(state.getTarget('eq-wz')?.node.enumerator).toBe('4');
    expect(state.getTarget('eq-xy')?.node.html_id).toBe(second.html_id);
    expect(second.html_id).toBe('eq-xy');
  });

  test('tagged rows show the tag and do not advance the counter', () => {
    const file = new VFile();
    const tree = pageWithMath([
      '\\begin{align}\na &= b \\tag{A} \\\\\nc &= d \\label{eq-cd}\n\\end{align}',
    ]);
    mathLabelTransform(tree, file);
    const state = new ReferenceState('page.md', { vfile: file, frontmatter: {} as any });
    enumerateTargetsTransform(tree, { state });
    const node = (tree.children as any[])[0];
    expect(node.rows.rows[0].enumerator).toBe('A');
    expect(node.rows.rows[1].enumerator).toBe('1');
    expect(state.getTarget('eq-cd')?.node.enumerator).toBe('1');
  });

  test('book-mode enumerators flow into the rows', () => {
    const file = new VFile();
    const tree = u('root', [
      u('heading', { depth: 1, enumerated: true }, [u('text', 'Chapter')]),
      u('math', { value: '\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}' }),
    ]) as any;
    mathLabelTransform(tree, file);
    const state = new ReferenceState('page.md', { vfile: file, ...BOOK_NUMBERING });
    enumerateTargetsTransform(tree, { state });
    const node = (tree.children as any[])[1];
    expect(node.rows.rows.map((r: any) => r.enumerator)).toEqual(['1.1', '1.2']);
  });

  test('starred align stays unnumbered and takes no block enumerator', () => {
    const file = new VFile();
    const tree = pageWithMath([
      '\\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}',
      '\\begin{equation}\nq = r\n\\end{equation}',
    ]);
    mathLabelTransform(tree, file);
    const state = new ReferenceState('page.md', { vfile: file, frontmatter: {} as any });
    enumerateTargetsTransform(tree, { state });
    const [starred, eq] = tree.children as any[];
    expect(starred.enumerated).toBe(false);
    expect(starred.enumerator).toBeUndefined();
    expect(eq.enumerator).toBe('1');
  });

  test('rendered HTML carries per-row tags with the alignment axis preserved', () => {
    const file = new VFile();
    const tree = pageWithMath([
      '\\begin{align}\nx &= y \\label{eq-xy} \\\\\nu &= v \\nonumber \\\\\nw &= z\n\\end{align}',
    ]);
    mathLabelTransform(tree, file);
    mathTransform(tree, file); // initial render, before enumeration
    const node = (tree.children as any[])[0];
    expect(node.html).toBeDefined();
    // No CSS-counter auto numbers in the visual HTML (the aria-hidden MathML
    // side may carry inert mml-eqn-num cells)
    const visualHtml = (html: string) => html.slice(html.indexOf('katex-html'));
    expect(visualHtml(node.html)).not.toContain('class="eqn-num"');
    const state = new ReferenceState('page.md', { vfile: file, ...BOOK_NUMBERING });
    enumerateTargetsTransform(tree, { state });
    expect(node.rows.rows.map((r: any) => r.enumerator)).toEqual(['1.1', undefined, '1.2']);
    renderRowNumberedMathTransform(tree, file);
    expect(node.html).toContain('1.1');
    expect(node.html).toContain('1.2'); // the \nonumber row was skipped, not the number
    expect(node.html).not.toContain('1.3');
    expect(visualHtml(node.html)).not.toContain('class="eqn-num"');
  });
});
