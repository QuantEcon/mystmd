---
'myst-transforms': minor
'myst-spec': patch
'myst-spec-ext': minor
'myst-cli': minor
'myst-to-tex': patch
'myst-to-jats': patch
---

Number align/gather/alignat rows per-row with amsmath semantics (#73): each `\\` row takes its own equation number with the shared alignment axis preserved, `\nonumber`/`\notag` suppresses a row's number, `\tag{...}` replaces it without advancing the counter, and a per-row `\label{...}` becomes that row's reference target. Starred environments are unnumbered. Numbers render as per-row KaTeX `\tag`s injected after enumeration; LaTeX export re-emits per-row labels so PDF numbering matches. Requires KaTeX >= 0.16 — the `katex` dependency is bumped from `^0.15.2` to `^0.16.21` (#80).
