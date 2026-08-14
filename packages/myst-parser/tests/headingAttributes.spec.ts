import { describe, expect, test } from 'vitest';
import type { Heading } from 'myst-spec-ext';
import { mystParse } from '../src';

function parseHeading(src: string, opts?: Parameters<typeof mystParse>[1]) {
  const mdast = mystParse(src, opts);
  return mdast.children.find((node) => node.type === 'heading') as unknown as Heading;
}

function headingText(heading: Heading) {
  return heading.children.map((child) => (child as any).value ?? '').join('');
}

describe('Parses heading attribute blocks', () => {
  test('.unnumbered sets enumerated false and strips the block', () => {
    const heading = parseHeading('## Further Reading {.unnumbered}');
    expect(heading.enumerated).toBe(false);
    expect(headingText(heading)).toBe('Further Reading');
  });
  test('pandoc {-} shorthand', () => {
    const heading = parseHeading('## Exercises {-}');
    expect(heading.enumerated).toBe(false);
    expect(headingText(heading)).toBe('Exercises');
  });
  test('explicit id becomes label and identifier', () => {
    const heading = parseHeading('## Validation Protocol {#sec-validation}');
    expect(heading.label).toBe('sec-validation');
    expect(heading.identifier).toBe('sec-validation');
    expect(headingText(heading)).toBe('Validation Protocol');
  });
  test('id, class, and unnumbered combine', () => {
    const heading = parseHeading('### Summary {#summary .fancy .unnumbered}');
    expect(heading.enumerated).toBe(false);
    expect(heading.label).toBe('summary');
    expect((heading as any).class).toBe('fancy');
    expect(headingText(heading)).toBe('Summary');
  });
  test('enumerated key, bare and quoted', () => {
    expect(parseHeading('## A {enumerated=false}').enumerated).toBe(false);
    expect(parseHeading('## B {enumerated="true"}').enumerated).toBe(true);
  });
  test('setext headings take attributes', () => {
    const heading = parseHeading('Introduction {.unnumbered}\n===');
    expect(heading.depth).toBe(1);
    expect(heading.enumerated).toBe(false);
    expect(headingText(heading)).toBe('Introduction');
  });
  test('headings inside directives take attributes', () => {
    const mdast = mystParse(':::{note}\n## Inner {.unnumbered}\n:::');
    // mystDirective > admonition > heading
    const heading = (mdast.children[0] as any).children[0].children.find(
      (node: any) => node.type === 'heading',
    );
    expect(heading.enumerated).toBe(false);
    expect(heading.children[0].value).toBe('Inner');
  });
});

describe('Leaves non-attribute braces untouched', () => {
  test('prose braces with commas', () => {
    const heading = parseHeading('## The set {1, 2, 3}');
    expect(heading.enumerated).toBeUndefined();
    expect(headingText(heading)).toBe('The set {1, 2, 3}');
  });
  test('single bare word is not an attribute block', () => {
    const heading = parseHeading('## The set {a}');
    expect(headingText(heading)).toBe('The set {a}');
  });
  test('empty braces', () => {
    const heading = parseHeading('## Heading {}');
    expect(headingText(heading)).toBe('Heading {}');
  });
  test('escaped brace is literal', () => {
    const heading = parseHeading('## Heading \\{.unnumbered}');
    expect(heading.enumerated).toBeUndefined();
    expect(headingText(heading)).toBe('Heading {.unnumbered}');
  });
  test('unknown key=value is not an attribute block', () => {
    const heading = parseHeading('## Heading {foo=bar}');
    expect(heading.enumerated).toBeUndefined();
    expect(headingText(heading)).toBe('Heading {foo=bar}');
  });
  test('multiple ids are not an attribute block', () => {
    const heading = parseHeading('## Heading {#one #two}');
    expect(headingText(heading)).toBe('Heading {#one #two}');
  });
  test('a brace block mid-heading is untouched', () => {
    const heading = parseHeading('## Heading {.class} trailing text');
    expect(headingText(heading)).toBe('Heading {.class} trailing text');
    expect((heading as any).class).toBeUndefined();
  });
  test('extension can be disabled', () => {
    const heading = parseHeading('## Heading {.unnumbered}', {
      extensions: { headingAttributes: false },
    });
    expect(heading.enumerated).toBeUndefined();
    expect(headingText(heading)).toBe('Heading {.unnumbered}');
  });
});
