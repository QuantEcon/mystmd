---
"myst-to-ipynb": patch
"myst-cli": patch
---

ipynb attachment embedding: preserve optional image titles when rewriting to `attachment:` references, resolve images written to the export `files/` output folder (e.g. executed notebook outputs) that don't exist relative to the source file, and read image files asynchronously.
