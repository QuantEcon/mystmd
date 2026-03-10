# myst-to-ipynb

Convert a MyST AST to Jupyter Notebook (`.ipynb`) format.

Part of the [mystmd](https://github.com/jupyter-book/mystmd) monorepo.

## Features

- **MyST markdown** (default) — preserves MyST syntax for use with [jupyterlab-myst](https://github.com/jupyter-book/jupyterlab-myst)
- **CommonMark markdown** (`markdown: commonmark`) — converts MyST directives/roles to plain CommonMark for vanilla Jupyter, JupyterLab, and Google Colab
- **Image attachments** (`images: attachment`) — embeds local images as base64 cell attachments for self-contained notebooks

## Usage

Configure exports in your page frontmatter:

```yaml
exports:
  - format: ipynb
    markdown: commonmark
    images: attachment
    output: exports/my-document.ipynb
```

Build with:

```bash
myst build --ipynb
```

See the [Creating Jupyter Notebooks](https://mystmd.org/guide/creating-notebooks) documentation for full details.
