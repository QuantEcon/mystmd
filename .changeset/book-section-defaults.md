---
"myst-cli": patch
---

Book mode: `injectBookSectionDefaults` now seeds the full `title → heading_1 → heading_2 → heading_3` chain per section tag, fixing chapter-prefix composition. With `numbering.book: true` and `section: chapters` (or `appendices`) on a TOC entry, figures, sections, and theorems on chapter pages now render as `1.1`, `1.1.1`, etc. instead of the broken flat `1`, `1` — authors no longer need a project-level `title.enabled: true` / `heading_2.enabled: true` workaround. The matching `section: frontmatter` / `backmatter` branch seeds `false` for the same chain so preface / back-matter pages stay unnumbered in the common case. All assignments use `??=` per §3.5(g) precedence (page > project > section > built-in), so per-page and per-project overrides always win. Closes QuantEcon/mystmd#25.
