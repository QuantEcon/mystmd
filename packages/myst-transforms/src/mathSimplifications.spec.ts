import { describe, expect, test } from 'vitest';
import { u } from 'unist-builder';
import { inlineMathSimplificationTransform } from './mathSimplifications';

describe('Test math transformations', () => {
  test.each([
    ['2.34', u('text', '2.34')],
    ['-2', u('text', '-2')],
    ['+2', u('text', '+2')],
    ['2.34', u('inlineMath', '2.34'), { replaceNumber: false }],
    ['-2', u('inlineMath', '-2'), { replaceNumber: false }],
    ['+2', u('inlineMath', '+2'), { replaceNumber: false }],
    ['_2', u('subscript', [u('text', '2')])],
    ['^2', u('superscript', [u('text', '2')])],
    ['^2', u('inlineMath', '^2'), { replaceNumber: false }],
    ['^2', u('superscript', [u('text', '2')]), { replaceText: false }],
    ['_{2}', u('subscript', [u('text', '2')])],
    ['^{+2}', u('superscript', [u('text', '+2')])],
    ['^{st}', u('superscript', [u('text', 'st')])],
    ['^{st}', u('inlineMath', '^{st}'), { replaceText: false }],
    ['^{st}', u('superscript', [u('text', 'st')]), { replaceNumber: false }],
    ['10^4', u('span', [u('text', '10'), u('superscript', [u('text', '4')])])],
    ['-10^4', u('span', [u('text', '-10'), u('superscript', [u('text', '4')])])],
    ['10^{-4}', u('span', [u('text', '10'), u('superscript', [u('text', '-4')])])],
    ['10^4', u('inlineMath', '10^4'), { replaceNumber: false }],
    ['10^{-4}', u('inlineMath', '10^{-4}'), { replaceNumber: false }],
    ['10_{+4.3}', u('span', [u('text', '10'), u('subscript', [u('text', '+4.3')])])],
    ['10_{+4.3}', u('inlineMath', '10_{+4.3}'), { replaceNumber: false }],
    ['^{\\alpha}', u('superscript', [u('text', 'α')])],
    ['_{\\alpha}', u('subscript', [u('text', 'α')])],
    ['^{\\unknown}', u('inlineMath', '^{\\unknown}')],
    ['\\circ', u('text', '∘')],
    ['\\circ', u('text', '∘'), { replaceSymbol: false }],
    ['^{\\circ}', u('text', '°'), { replaceSymbol: false }],
    ['^{\\circ}', u('text', '°')],
    ['\\alpha', u('inlineMath', '\\alpha'), { replaceSymbol: false }],
    ['_{\\alpha}', u('inlineMath', '_{\\alpha}'), { replaceSymbol: false }],
    ['\\degree', u('text', '°'), { replaceSymbol: false }],
    ['\\degree', u('inlineMath', '\\degree'), { replaceText: false }],
    // The pair the myst-cli document pipeline wires: numbers reach KaTeX,
    // typing shortcuts are still replaced.
    ['2.5', u('inlineMath', '2.5'), { replaceSymbol: false, replaceNumber: false }],
    ['-1', u('inlineMath', '-1'), { replaceSymbol: false, replaceNumber: false }],
    ['10^{-4}', u('inlineMath', '10^{-4}'), { replaceSymbol: false, replaceNumber: false }],
    ['^{\\circ}', u('text', '°'), { replaceSymbol: false, replaceNumber: false }],
    ['\\pm', u('text', '±'), { replaceSymbol: false, replaceNumber: false }],
  ] as [string, any, Parameters<typeof inlineMathSimplificationTransform>[1]][])(
    '%s',
    (value, after, opts) => {
      const node = { type: 'inlineMath', value } as any;
      const mdast = { children: [node] } as any;
      inlineMathSimplificationTransform(mdast, opts);
      expect(node).toMatchObject(after);
    },
  );
});
