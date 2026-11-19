import { describe, expect, it } from 'vitest';
import { VFile } from 'vfile';
import { selectAll } from 'unist-util-select';
import type { GenericNode, GenericParent } from 'myst-common';
import type { IReferenceStateResolver } from 'myst-transforms';
import { Session } from '../session';
import { castSession } from '../session/cache';
import { embedTransform } from './embed';

// A real-sized image: far longer than the content minify leaves inline
const IMAGE = 'iVBORw0KGgo'.padEnd(40000, 'A');

function cell(
  identifier: string,
  visibility: { block?: string; code?: string; outputs?: string } = {},
): GenericNode {
  return {
    type: 'block',
    kind: 'notebook-code',
    identifier,
    label: identifier,
    visibility: visibility.block ?? 'show',
    children: [
      {
        type: 'code',
        lang: 'python',
        executable: true,
        value: 'fig',
        visibility: visibility.code ?? 'show',
      },
      {
        type: 'outputs',
        visibility: visibility.outputs ?? 'show',
        children: [
          {
            type: 'output',
            jupyter_data: {
              output_type: 'display_data',
              metadata: {},
              data: { 'image/png': IMAGE, 'text/plain': '<Figure>' },
            },
          },
        ],
      },
    ],
  };
}

/**
 * Embed `label` from a notebook into a page, on a single page, and return the
 * embedded nodes, the notebook and the session
 */
async function embed(source: GenericNode[], embedNode: GenericNode) {
  const session = new Session();
  const notebook = { type: 'root', children: source } as GenericParent;
  castSession(session).$setMdast('notebook.ipynb', { post: { mdast: notebook } } as any);
  const state = {
    vfile: new VFile(),
    resolveStateProvider: () => ({
      filePath: 'notebook.ipynb',
      getFileTarget: () => undefined,
    }),
  } as unknown as IReferenceStateResolver;
  const page = { type: 'root', children: [embedNode] } as GenericParent;
  await embedTransform(session, page, 'page.md', [], state);
  return { page, notebook, cache: castSession(session).$outputs };
}

function outputsOf(tree: GenericNode) {
  return selectAll('outputs', tree) as GenericNode[];
}

describe('embedTransform', () => {
  it('shows the removed output of an embedded cell, minified to be written', async () => {
    const { page, notebook, cache } = await embed([cell('my-cell', { outputs: 'remove' })], {
      type: 'embed',
      source: { label: 'my-cell' },
      'remove-input': true,
    });
    const [outputs] = outputsOf(page);
    expect(outputs.visibility).toBe('show');
    const { hash } = outputs.children?.[0].jupyter_data.data['image/png'];
    expect(hash).toBeTruthy();
    expect(cache[hash]).toBeDefined();
    // The notebook keeps its output removed, and not minified
    const [source] = outputsOf(notebook);
    expect(source.visibility).toBe('remove');
    expect(source.children?.[0].jupyter_data.data['image/png']).toBe(IMAGE);
  });

  it('leaves removed code removed', async () => {
    const { page } = await embed([cell('my-cell', { code: 'remove', outputs: 'remove' })], {
      type: 'embed',
      source: { label: 'my-cell' },
    });
    const [code] = selectAll('code', page) as GenericNode[];
    expect(code.visibility).toBe('remove');
    expect(outputsOf(page)[0].visibility).toBe('show');
  });

  it('shows the output of a removed cell, as before', async () => {
    const { page } = await embed([cell('my-cell', { block: 'remove' })], {
      type: 'embed',
      source: { label: 'my-cell' },
      'remove-input': true,
    });
    expect(outputsOf(page)[0].visibility).toBe('show');
  });

  it('leaves a hidden output hidden', async () => {
    const { page } = await embed([cell('my-cell', { outputs: 'hide' })], {
      type: 'embed',
      source: { label: 'my-cell' },
    });
    expect(outputsOf(page)[0].visibility).toBe('hide');
  });

  it('drops the output when the embed itself removes it', async () => {
    const { page, cache } = await embed([cell('my-cell', { outputs: 'remove' })], {
      type: 'embed',
      source: { label: 'my-cell' },
      'remove-output': true,
    });
    expect(selectAll('output', page)).toEqual([]);
    expect(Object.keys(cache)).toEqual([]);
  });

  it('embeds a section as it is', async () => {
    const { page, cache } = await embed(
      [
        { type: 'heading', depth: 2, identifier: 'my-section', children: [] },
        cell('my-cell', { outputs: 'remove' }),
      ],
      { type: 'embed', source: { label: 'my-section' } },
    );
    expect(outputsOf(page)[0].visibility).toBe('remove');
    expect(Object.keys(cache)).toEqual([]);
  });
});
