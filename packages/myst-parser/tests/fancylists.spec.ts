import { describe, expect, test } from 'vitest';
import type { List } from 'myst-spec-ext';
import { mystParse } from '../src';

function parseLists(src: string, opts?: Parameters<typeof mystParse>[1]) {
  const mdast = mystParse(src, opts);
  return mdast.children.filter((node) => node.type === 'list') as unknown as List[];
}

function itemText(list: List, index: number) {
  return ((list.children[index] as any).children[0] as any).children[0].value;
}

describe('Parses pandoc-style fancy lists', () => {
  test('lower-roman markers', () => {
    const [list] = parseLists('i. first\nii. second\niii. third');
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(1);
    expect(list.style).toBe('lower-roman');
    expect(list.delimiter).toBeUndefined();
    expect(list.children.length).toBe(3);
    expect(itemText(list, 0)).toBe('first');
  });
  test('parenthesized roman markers', () => {
    const [list] = parseLists('(i) first\n(ii) second');
    expect(list.style).toBe('lower-roman');
    expect(list.delimiter).toBe('parens');
    expect(list.children.length).toBe(2);
    expect(itemText(list, 1)).toBe('second');
  });
  test('upper-roman markers', () => {
    const [list] = parseLists('I) first\nII) second');
    expect(list.style).toBe('upper-roman');
    expect(list.delimiter).toBe('paren');
  });
  test('alphabetic markers infer start', () => {
    const [list] = parseLists('c. third\nd. fourth');
    expect(list.style).toBe('lower-alpha');
    expect(list.start).toBe(3);
  });
  test('upper-alpha with paren', () => {
    const [list] = parseLists('A) one\nB) two');
    expect(list.style).toBe('upper-alpha');
    expect(list.delimiter).toBe('paren');
  });
  test('parenthesized decimal markers', () => {
    const [list] = parseLists('(1) one\n(2) two');
    expect(list.style).toBeUndefined();
    expect(list.delimiter).toBe('parens');
  });
  test('roman numerals beyond i', () => {
    const [list] = parseLists('iv. four\nv. five\nvi. six');
    expect(list.style).toBe('lower-roman');
    expect(list.start).toBe(4);
  });
  test('single letter that could be roman starts an alphabetic list', () => {
    // Pandoc rule: "C." is upper-alpha starting at 3, not roman 100
    const [list] = parseLists('C)  one\nD)  two');
    expect(list.style).toBe('upper-alpha');
    expect(list.start).toBe(3);
  });
  test('# continuation marker', () => {
    const [list] = parseLists('i. first\n#. second\n#. third');
    expect(list.style).toBe('lower-roman');
    expect(list.children.length).toBe(3);
  });
  test('plain decimal lists keep an unchanged AST', () => {
    const lists = parseLists('1. one\n2. two\n\nthen\n\n3) three\n4) four');
    expect(lists.length).toBe(2);
    expect(lists[0].style).toBeUndefined();
    expect(lists[0].delimiter).toBeUndefined();
    expect(lists[1].style).toBeUndefined();
    expect(lists[1].delimiter).toBeUndefined();
    expect(lists[1].start).toBe(3);
  });
  test('changing the marker style starts a new list', () => {
    const lists = parseLists('a. one\nb) two');
    expect(lists.length).toBe(2);
    expect(lists[0].delimiter).toBeUndefined();
    expect(lists[1].delimiter).toBe('paren');
  });
  test('parenthesized and bare markers do not continue each other', () => {
    const lists = parseLists('(i) one\nii) two');
    expect(lists.length).toBe(2);
    expect(lists[0].delimiter).toBe('parens');
    expect(lists[1].delimiter).toBe('paren');
  });
  test('single uppercase letter with period requires two spaces', () => {
    const mdast = mystParse('B. Russell was an English philosopher.');
    expect(mdast.children[0].type).toBe('paragraph');
    const [list] = parseLists('B.  one\nC.  two');
    expect(list.style).toBe('upper-alpha');
    expect(list.start).toBe(2);
  });
  test('unclosed parenthesis is not a list marker', () => {
    const mdast = mystParse('(i. not a list');
    expect(mdast.children[0].type).toBe('paragraph');
  });
  test('nested fancy list inside a bullet list', () => {
    const mdast = mystParse('- item\n  (i) sub one\n  (ii) sub two');
    const outer = mdast.children[0] as unknown as List;
    expect(outer.type).toBe('list');
    const inner = (outer.children[0] as any).children.find(
      (node: any) => node.type === 'list',
    ) as List;
    expect(inner.style).toBe('lower-roman');
    expect(inner.delimiter).toBe('parens');
  });
  test('extension can be disabled', () => {
    const mdast = mystParse('i. first\nii. second', { extensions: { fancyLists: false } });
    expect(mdast.children[0].type).toBe('paragraph');
    // and plain ordered lists still work through the default rule
    const lists = parseLists('3. three\n4. four', { extensions: { fancyLists: false } });
    expect(lists[0].ordered).toBe(true);
    expect(lists[0].start).toBe(3);
  });
});
