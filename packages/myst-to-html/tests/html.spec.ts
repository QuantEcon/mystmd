import { describe, expect, it } from 'vitest';
import { u } from 'unist-builder';
import { mystToHtml } from '../src';

describe('mystToHtml', () => {
  it('Converts a tag schema to a string', () => {
    const html = mystToHtml(u('root', [u('paragraph', [u('text', 'hello world')])]));
    expect(html).toBe('<p>hello world</p>');
  });
  it('Converts comment', () => {
    const html = mystToHtml(u('root', [u('comment', 'hello world')]) as any);
    expect(html).toBe('<!--hello world-->');
  });
  it('Html node is empty by default', () => {
    const html = mystToHtml(u('root', [u('html', '<p>hello world</>')]) as any);
    expect(html).toBe('');
  });
  it('Applies `math-inline` to `inlineMath` nodes', () => {
    const html = mystToHtml(u('root', [u('paragraph', [u('inlineMath', 'y = a x + b')])]));
    expect(html).toBe('<p><span class="math-inline">y = a x + b</span></p>');
  });
  it('Applies `math-display` to `math` nodes', () => {
    const html = mystToHtml(u('root', [u('math', 'y = a x + b')]));
    expect(html).toBe('<div class="math-display">y = a x + b</div>');
  });
  it('Renders fancy ordered lists with a type attribute and delimiter class', () => {
    const html = mystToHtml(
      u('root', [
        u('list', { ordered: true, start: 1, style: 'lower-roman', delimiter: 'parens' }, [
          u('listItem', [u('text', 'one')]),
        ]),
      ]),
    );
    expect(html).toBe('<ol type="i" class="delimiter-parens">\n<li>\none\n</li>\n</ol>');
  });
  it('Renders fancy ordered lists with start and paren delimiter', () => {
    const html = mystToHtml(
      u('root', [
        u('list', { ordered: true, start: 4, style: 'upper-alpha', delimiter: 'paren' }, [
          u('listItem', [u('text', 'four')]),
        ]),
      ]),
    );
    expect(html).toBe('<ol start="4" type="A" class="delimiter-paren">\n<li>\nfour\n</li>\n</ol>');
  });
  it('Renders plain ordered lists without list attributes', () => {
    const html = mystToHtml(
      u('root', [u('list', { ordered: true, start: 1 }, [u('listItem', [u('text', 'plain')])])]),
    );
    expect(html).toBe('<ol>\n<li>\nplain\n</li>\n</ol>');
  });
});
