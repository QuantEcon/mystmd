---
'markdown-it-myst': minor
'myst-parser': minor
---

Pandoc-style attribute blocks on headings (#68): `## Title {#id .class .unnumbered}` sets the heading's `label`/`identifier`, `class`, and `enumerated` fields and strips the block from the heading text. `.unnumbered` (or the pandoc shorthand `{-}`, or `enumerated=false`) excludes the heading from numbering without advancing the counter — `\section*` semantics; the enumerate transform already honors `enumerated: false` so no transform changes are needed. Applies to ATX and setext headings, including inside directive bodies. A brace block that is not entirely recognized attributes (e.g. `## The set {1, 2, 3}`) is left as literal text, and an escaped `\{` never matches. Opt out with `extensions.headingAttributes: false`.
