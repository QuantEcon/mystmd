---
title: Creating Jupyter Notebooks
description: Export MyST documents to Jupyter Notebook (.ipynb) format with optional CommonMark markdown and embedded images.
---

You can export MyST documents to Jupyter Notebook (`.ipynb`) format using `myst build`. The exported notebooks can use either MyST markdown (for use with [jupyterlab-myst](https://github.com/jupyter-book/jupyterlab-myst)) or plain CommonMark markdown compatible with vanilla Jupyter Notebook, JupyterLab, and Google Colab.

## Basic usage

Add an `exports` entry with `format: ipynb` to your page frontmatter:

```{code-block} yaml
:filename: my-document.md
---
exports:
  - format: ipynb
    output: exports/my-document.ipynb
---
```

Build the notebook with:

```bash
myst build my-document.md --ipynb
```

Or build all ipynb exports in the project:

```bash
myst build --ipynb
```

## CommonMark markdown

By default, exported notebooks use MyST markdown in their cells. If you need compatibility with environments that don't support MyST (vanilla Jupyter, Colab, etc.), set `markdown: commonmark`:

```{code-block} yaml
:filename: my-document.md
---
exports:
  - format: ipynb
    markdown: commonmark
    output: exports/my-document.ipynb
---
```

With `markdown: commonmark`, MyST-specific syntax is converted to plain CommonMark equivalents:

```{list-table} CommonMark conversions
:header-rows: 1
- * MyST syntax
  * CommonMark output
- * `:::{note}` admonitions
  * `> **Note**` blockquotes
- * `` {math}`E=mc^2` `` roles
  * `$E=mc^2$` dollar math
- * `$$` math blocks
  * `$$...$$` (preserved)
- * `:::{exercise}` directives
  * **Exercise N** bold headers
- * `:::{proof:theorem}` directives
  * **Theorem N** bold headers
- * Figures with captions
  * `![alt](url)` with italic caption
- * Tab sets
  * Bold tab titles with content
- * `{image}` directives
  * `![alt](url)` images
- * `(label)=` targets
  * Dropped (no CommonMark equivalent)
- * `% comments`
  * Dropped
```

## Embedding images as cell attachments

By default, images in exported notebooks reference external files. To create fully self-contained notebooks with images embedded as base64 cell attachments, set `images: attachment`:

```{code-block} yaml
:filename: my-document.md
---
exports:
  - format: ipynb
    markdown: commonmark
    images: attachment
    output: exports/my-document.ipynb
---
```

With `images: attachment`:
- Local images are read from disk and base64-encoded
- Image references become `![alt](attachment:filename.png)`
- Each cell includes an `attachments` field with the image data
- Remote images (http/https URLs) are left as references

This is useful for distributing notebooks, uploading to Google Colab, or sharing via email where external image files may not be available.

## Export options

```{list-table} ipynb export options
:header-rows: 1
- * Option
  * Values
  * Description
- * `format`
  * `ipynb`
  * Required — specifies notebook export
- * `output`
  * string
  * Output filename or folder
- * `markdown`
  * `myst` (default), `commonmark`
  * Markdown format for notebook cells
- * `images`
  * `reference` (default), `attachment`
  * How to handle images — references or embedded attachments
```
