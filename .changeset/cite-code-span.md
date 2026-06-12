---
"markdown-it-myst": patch
---

Citation detection no longer scans through inline code spans: an `@`-token enclosed in backticks inside a bracket (e.g. ``[wrap it in `@tf.function` for speed]``) is literal code, not a citation key, so the bracket text and code formatting are preserved instead of becoming a broken cite node.
