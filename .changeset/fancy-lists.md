---
"myst-parser": minor
"myst-spec-ext": patch
"myst-to-html": patch
"myst-to-tex": patch
"myst-to-typst": patch
"myst-to-jats": patch
---

Support Pandoc-style fancy ordered lists: `a.`, `B)`, `iv.`, `(i)` markers parse as ordered lists with inferred numbering style and start. The `list` node records `style` (`lower-alpha`, `upper-alpha`, `lower-roman`, `upper-roman`) and `delimiter` (`paren`, `parens`), which render to HTML (`<ol type>` + delimiter class), LaTeX (`enumitem` labels) and Typst (`#set enum(numbering: ...)`), and map to the JATS `list-type` attribute. Enabled by default; disable with the `fancyLists: false` parser extension.
