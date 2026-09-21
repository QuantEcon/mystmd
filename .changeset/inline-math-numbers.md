---
'myst-cli': patch
---

Numbers written as inline maths are no longer rewritten to text. The document pipeline now wires `inlineMathSimplificationPlugin` with `replaceNumber: false` alongside the existing `replaceSymbol: false`, so `$2.5$`, `$-1$`, `$+3$` and `$10^{-4}$` stay `inlineMath` nodes and are typeset by KaTeX instead of becoming `text` / `span` nodes that copy the literal source. A standalone number is now set in the same face as the same value inside `$x = 2.5$`, and a negative number renders a true minus sign (U+2212) rather than the U+002D hyphen-minus the old text node carried over from the source. Exports follow the same path — a number now round-trips as maths in LaTeX, Typst, JATS and Markdown rather than as a bare text run. The typing shortcuts the transform exists for — `$\pm$`, `$\degree$`, `37$^\circ$C` — are unchanged.
