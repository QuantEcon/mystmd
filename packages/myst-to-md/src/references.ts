import type { Handle, Info } from 'mdast-util-to-markdown';
import { defaultHandlers } from 'mdast-util-to-markdown';
import type { NestedState, Parent } from './types.js';

function labelWrapper(handler: Handle) {
  return (node: any, _: Parent, state: NestedState, info: Info): string => {
    const ident = node.identifier ?? node.label;
    const prefix = ident ? `(${ident})=\n` : '';
    return `${node.implicit ? '' : prefix}${handler(node, _, state, info)}`;
  };
}

function crossReference(node: any, _: Parent, state: NestedState, info: Info): string {
  const { urlSource, label, identifier, url, html_id } = node;
  const resolvedUrl =
    urlSource ??
    (label ? `#${label}` : identifier ? `#${identifier}` : html_id ? `#${html_id}` : url ?? '');
  if (!resolvedUrl && process.env.MYST_DEBUG_XREF) {
    const childText = node.children
      ?.map((c: any) => c.value ?? '')
      .join('')
      .slice(0, 80);
    console.warn(
      `[myst-to-md] crossReference has empty URL:\n` +
        `  identifier : ${JSON.stringify(node.identifier)}\n` +
        `  label      : ${JSON.stringify(node.label)}\n` +
        `  urlSource  : ${JSON.stringify(node.urlSource)}\n` +
        `  url        : ${JSON.stringify(node.url)}\n` +
        `  html_id    : ${JSON.stringify(node.html_id)}\n` +
        `  kind       : ${JSON.stringify(node.kind)}\n` +
        `  resolved   : ${JSON.stringify(node.resolved)}\n` +
        `  remote     : ${JSON.stringify(node.remote)}\n` +
        `  childText  : ${JSON.stringify(childText)}\n` +
        `  full node  : ${JSON.stringify(node, null, 2)}`,
    );
  }
  const nodeCopy = {
    ...node,
    url: resolvedUrl,
  };
  return defaultHandlers.link(nodeCopy, _, state, info);
}

export const referenceHandlers: Record<string, Handle> = {
  crossReference,
  heading: labelWrapper(defaultHandlers.heading),
  paragraph: labelWrapper(defaultHandlers.paragraph),
  blockquote: labelWrapper(defaultHandlers.blockquote),
  list: labelWrapper(defaultHandlers.list),
};
