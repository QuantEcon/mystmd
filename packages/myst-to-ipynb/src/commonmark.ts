/**
 * CommonMark AST pre-transform for myst-to-ipynb
 *
 * Converts MyST-specific AST nodes into their CommonMark-equivalent AST nodes
 * so that `writeMd` from `myst-to-md` produces plain CommonMark output
 * compatible with vanilla Jupyter Notebook, JupyterLab, and Google Colab.
 *
 * This transform is applied before `writeMd` is called for each markdown cell.
 * It walks the AST tree and replaces MyST directive/role nodes with standard
 * mdast nodes that `writeMd` already handles natively.
 */

import type { GenericNode } from 'myst-common';
import { toText } from 'myst-common';
import { selectAll, select } from 'unist-util-select';

/**
 * Capitalize the first letter of a string.
 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Convert an admonition node to a blockquote with bold title.
 *
 * Input:  { type: 'admonition', kind: 'note', children: [admonitionTitle, ...content] }
 * Output: { type: 'blockquote', children: [paragraph(bold(title)), ...content] }
 */
function transformAdmonition(node: GenericNode): GenericNode {
  const kind = node.kind ?? 'note';
  const titleNode = node.children?.find((c: GenericNode) => c.type === 'admonitionTitle');
  const titleText = titleNode ? toText(titleNode) : capitalize(kind);
  const contentChildren =
    node.children?.filter((c: GenericNode) => c.type !== 'admonitionTitle') ?? [];
  return {
    type: 'blockquote',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'strong', children: [{ type: 'text', value: titleText }] }],
      },
      ...contentChildren,
    ],
  };
}

/**
 * Convert a math block directive to a raw html node containing `$$...$$`.
 *
 * We use an `html` type node because mdast serializers output its `value`
 * as-is, without escaping underscores or other special characters that
 * commonly appear in LaTeX expressions.
 *
 * Input:  { type: 'math', value: 'E=mc^2', label: '...' }
 * Output: { type: 'html', value: '$$\nE=mc^2\n$$' }
 */
function transformMathBlock(node: GenericNode): GenericNode {
  const value = node.value ?? '';
  const labelComment = node.label ? ` (${node.label})` : '';
  return {
    type: 'html',
    value: `$$\n${value}\n$$${labelComment}`,
  };
}

/**
 * Convert an inline math role to a raw html node with `$...$` delimiters.
 *
 * Input:  { type: 'inlineMath', value: 'E=mc^2' }
 * Output: { type: 'html', value: '$E=mc^2$' }
 *
 * We use an `html` type node so the markdown serializer outputs the value
 * as-is, preventing underscore/backslash escaping in LaTeX expressions.
 * Jupyter's markdown renderer supports `$...$` for inline math natively.
 */
function transformInlineMath(node: GenericNode): GenericNode {
  return { type: 'html', value: `$${node.value ?? ''}$` };
}

/**
 * Convert a figure container to an image with caption text.
 *
 * Input:  { type: 'container', kind: 'figure', children: [image, caption, legend] }
 * Output: { type: 'image', url: '...', alt: 'caption text' }
 *         followed by caption paragraph if present
 */
function transformFigure(node: GenericNode): GenericNode {
  const imageNode: GenericNode | null = select('image', node);
  const captionNode: GenericNode | null = select('caption', node);
  const legendNode: GenericNode | null = select('legend', node);

  const url = imageNode?.urlSource ?? imageNode?.url ?? '';
  const alt = imageNode?.alt ?? (captionNode ? toText(captionNode) : '');

  const children: GenericNode[] = [{ type: 'image', url, alt, title: imageNode?.title }];

  // Add caption as a paragraph below the image if present
  if (captionNode?.children?.length) {
    children.push({
      type: 'paragraph',
      children: [{ type: 'emphasis', children: captionNode.children }],
    });
  }

  // Add legend content as-is
  if (legendNode?.children?.length) {
    children.push(...legendNode.children);
  }

  return { type: 'root', children };
}

/**
 * Convert a table container to its inner table node.
 * The table node is already handled by myst-to-md's GFM table extension.
 */
function transformTableContainer(node: GenericNode): GenericNode {
  const captionNode: GenericNode | null = select('caption', node);
  const tableNode: GenericNode | null = select('table', node);

  const children: GenericNode[] = [];

  // Add caption as bold paragraph above the table
  if (captionNode?.children?.length) {
    children.push({
      type: 'paragraph',
      children: [{ type: 'strong', children: captionNode.children }],
    });
  }

  if (tableNode) {
    children.push(tableNode);
  }

  return { type: 'root', children };
}

/**
 * Convert an exercise node to a bold header with content.
 *
 * Input:  { type: 'exercise', children: [...] }
 * Output: { type: 'root', children: [paragraph(**Exercise N**), ...content] }
 */
function transformExercise(node: GenericNode): GenericNode {
  const titleNode = node.children?.find((c: GenericNode) => c.type === 'admonitionTitle');
  const titleText = titleNode ? toText(titleNode) : 'Exercise';
  const enumerator = node.enumerator ? ` ${node.enumerator}` : '';
  const contentChildren =
    node.children?.filter((c: GenericNode) => c.type !== 'admonitionTitle') ?? [];

  return {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'strong',
            children: [{ type: 'text', value: `${titleText}${enumerator}` }],
          },
        ],
      },
      ...contentChildren,
    ],
  };
}

/**
 * Convert a solution node to a bold header with content.
 * Solutions are kept by default but can be configured to be dropped.
 */
function transformSolution(node: GenericNode, dropSolutions: boolean): GenericNode | null {
  if (dropSolutions) return null;

  const titleNode = node.children?.find((c: GenericNode) => c.type === 'admonitionTitle');
  const titleText = titleNode ? toText(titleNode) : 'Solution';
  const contentChildren =
    node.children?.filter((c: GenericNode) => c.type !== 'admonitionTitle') ?? [];

  return {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'strong',
            children: [{ type: 'text', value: titleText }],
          },
        ],
      },
      ...contentChildren,
    ],
  };
}

/**
 * Convert a proof-type node (theorem, lemma, definition, etc.) to a bold header.
 *
 * Input:  { type: 'proof', kind: 'theorem', children: [...] }
 * Output: { type: 'root', children: [paragraph(**Theorem N** (Title)), ...content] }
 */
function transformProof(node: GenericNode): GenericNode {
  const kind = node.kind ?? 'proof';
  const titleNode = node.children?.find((c: GenericNode) => c.type === 'admonitionTitle');
  const titleText = titleNode ? ` (${toText(titleNode)})` : '';
  const enumerator = node.enumerator ? ` ${node.enumerator}` : '';
  const contentChildren =
    node.children?.filter((c: GenericNode) => c.type !== 'admonitionTitle') ?? [];

  return {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'strong',
            children: [{ type: 'text', value: `${capitalize(kind)}${enumerator}${titleText}` }],
          },
        ],
      },
      ...contentChildren,
    ],
  };
}

/**
 * Convert a tab-set to just the content of each tab, with tab titles as headings.
 */
function transformTabSet(node: GenericNode): GenericNode {
  const children: GenericNode[] = [];

  for (const tabItem of node.children ?? []) {
    if (tabItem.type === 'tabItem' || tabItem.kind === 'tabItem') {
      // Add tab title as bold paragraph
      if (tabItem.title) {
        children.push({
          type: 'paragraph',
          children: [{ type: 'strong', children: [{ type: 'text', value: tabItem.title }] }],
        });
      }
      // Add tab content
      if (tabItem.children) {
        children.push(...tabItem.children);
      }
    }
  }

  return { type: 'root', children };
}

/**
 * Convert a card to its content with optional title.
 */
function transformCard(node: GenericNode): GenericNode {
  const titleNode = node.children?.find((c: GenericNode) => c.type === 'cardTitle');
  const contentChildren =
    node.children?.filter(
      (c: GenericNode) => !['cardTitle', 'header', 'footer'].includes(c.type),
    ) ?? [];

  const children: GenericNode[] = [];

  if (titleNode) {
    children.push({
      type: 'paragraph',
      children: [
        {
          type: 'strong',
          children: titleNode.children ?? [{ type: 'text', value: toText(titleNode) }],
        },
      ],
    });
  }

  children.push(...contentChildren);

  return { type: 'root', children };
}

/**
 * Convert a grid to its card children (which will be individually transformed).
 */
function transformGrid(node: GenericNode): GenericNode {
  return { type: 'root', children: node.children ?? [] };
}

/**
 * Convert a details/dropdown to a blockquote with summary as title.
 */
function transformDetails(node: GenericNode): GenericNode {
  const summaryNode = node.children?.find((c: GenericNode) => c.type === 'summary');
  const contentChildren = node.children?.filter((c: GenericNode) => c.type !== 'summary') ?? [];

  const titleText = summaryNode ? toText(summaryNode) : 'Details';

  return {
    type: 'blockquote',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'strong', children: [{ type: 'text', value: titleText }] }],
      },
      ...contentChildren,
    ],
  };
}

/**
 * Convert an aside/sidebar/margin to a blockquote.
 */
function transformAside(node: GenericNode): GenericNode {
  const titleNode = node.children?.find((c: GenericNode) => c.type === 'admonitionTitle');
  const contentChildren =
    node.children?.filter((c: GenericNode) => c.type !== 'admonitionTitle') ?? [];

  const children: GenericNode[] = [];

  if (titleNode) {
    children.push({
      type: 'paragraph',
      children: [{ type: 'strong', children: titleNode.children ?? [] }],
    });
  }

  children.push(...contentChildren);

  return { type: 'blockquote', children };
}

/**
 * Convert a code-block directive to a standard fenced code block.
 * (Remove MyST-specific options like label, emphasize-lines, etc.)
 */
function transformCodeBlock(node: GenericNode): GenericNode {
  return {
    type: 'code',
    lang: node.lang,
    value: node.value ?? '',
  };
}

/**
 * Convert an image node to a plain markdown image by stripping
 * directive-specific properties (class, width, align) that cause
 * myst-to-md to render it as a ```{image} directive.
 */
function transformImage(node: GenericNode): GenericNode {
  return {
    type: 'image',
    url: node.url ?? node.urlSource ?? '',
    alt: node.alt ?? '',
    title: node.title,
  };
}

/**
 * Convert a mystDirective node to plain content or remove it.
 */
function transformMystDirective(node: GenericNode): GenericNode | null {
  // If it has children, keep the content
  if (node.children?.length) {
    return { type: 'root', children: node.children };
  }
  // If it has a value, render as a code block
  if (node.value) {
    return { type: 'code', lang: node.lang ?? '', value: node.value };
  }
  return null;
}

/**
 * Convert a mystRole node to plain text.
 */
function transformMystRole(node: GenericNode): GenericNode {
  if (node.children?.length) {
    return { type: 'root', children: node.children };
  }
  return { type: 'text', value: node.value ?? '' };
}

export interface CommonMarkOptions {
  /** Drop solution blocks from output (default: false) */
  dropSolutions?: boolean;
}

/**
 * Walk an AST tree and replace MyST-specific nodes with CommonMark equivalents.
 *
 * This modifies the tree in-place by replacing children arrays.
 * Returns the (possibly replaced) root node.
 */
export function transformToCommonMark(tree: GenericNode, opts?: CommonMarkOptions): GenericNode {
  const dropSolutions = opts?.dropSolutions ?? false;

  // Process children recursively (bottom-up so nested directives are handled first)
  if (tree.children) {
    // First, recurse into children
    tree.children = tree.children.map((child: GenericNode) => transformToCommonMark(child, opts));

    // Then, transform this node's children — replacing nodes that need conversion
    const newChildren: GenericNode[] = [];
    for (const child of tree.children) {
      const transformed = transformNode(child, dropSolutions);
      if (transformed === null) {
        // Node should be dropped (e.g., solution with dropSolutions=true)
        continue;
      }
      if (transformed.type === 'root' && transformed.children) {
        // Flatten: a root wrapper means multiple replacement nodes
        newChildren.push(...transformed.children);
      } else {
        newChildren.push(transformed);
      }
    }
    tree.children = newChildren;

    // Strip identifier/label from all transformed children to prevent
    // myst-to-md's labelWrapper from adding `(identifier)=\n` prefixes
    // to headings, paragraphs, blockquotes, lists, etc.
    // This runs AFTER transformNode so transforms can still use label/identifier.
    for (const child of tree.children) {
      delete child.identifier;
      delete child.label;
    }
  }

  return tree;
}

/**
 * Transform a single node if it's a MyST-specific type.
 * Returns the node unchanged if no transformation is needed.
 * Returns null if the node should be removed.
 */
function transformNode(node: GenericNode, dropSolutions: boolean): GenericNode | null {
  switch (node.type) {
    case 'admonition':
      return transformAdmonition(node);
    case 'math':
      return transformMathBlock(node);
    case 'inlineMath':
      return transformInlineMath(node);
    case 'container':
      if (node.kind === 'figure') return transformFigure(node);
      if (node.kind === 'table') return transformTableContainer(node);
      // code containers — extract the code node
      if (node.kind === 'code') {
        const codeNode = select('code', node);
        return codeNode ? transformCodeBlock(codeNode as GenericNode) : node;
      }
      return node;
    case 'exercise':
      return transformExercise(node);
    case 'solution':
      return transformSolution(node, dropSolutions);
    case 'proof':
      return transformProof(node);
    case 'tabSet':
      return transformTabSet(node);
    case 'card':
      return transformCard(node);
    case 'grid':
      return transformGrid(node);
    case 'details':
      return transformDetails(node);
    case 'aside':
      return transformAside(node);
    case 'include':
      // Include directives are resolved during transformMdast — their children
      // contain the fully-parsed content from the included file.  Unwrap them
      // so the resolved content is emitted instead of the directive syntax.
      if (node.children?.length) {
        return { type: 'root', children: node.children };
      }
      return null;
    case 'mystDirective':
      return transformMystDirective(node);
    case 'mystRole':
      return transformMystRole(node);
    case 'mystTarget':
      // Drop MyST target labels — they have no CommonMark equivalent
      return null;
    case 'comment':
      // Drop MyST comments (% comment syntax) — not valid in CommonMark
      return null;
    case 'code':
      // Strip extra MyST attributes (class, emphasize-lines, etc.) so myst-to-md
      // renders this as a plain fenced code block instead of a ```{code-block} directive
      return transformCodeBlock(node);
    case 'image':
      // Strip directive-specific properties (class, width, align) so myst-to-md
      // renders this as ![alt](url) instead of a ```{image} directive
      return transformImage(node);
    default:
      return node;
  }
}
