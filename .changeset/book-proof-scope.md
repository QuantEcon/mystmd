---
"myst-frontmatter": patch
"myst-transforms": patch
---

Book mode: `scope` option on `NumberingItem` opts kinds into a section-level (LaTeX `\newtheorem{...}[section]`) auto-prefix. With `numbering.proof.scope: section`, theorems/lemmas render as `5.1.1, 5.1.2, 5.2.1` (chapter.section.counter) and reset on each new heading_2. Accepted values: `chapter`/`heading_1` (default — today's behaviour), `section`/`heading_2`, `subsection`/`heading_3`, `heading_4`..`heading_6`. Per-kind `scope` (`numbering.proof:theorem.scope`) overrides the `proof` umbrella, which overrides `numbering.all.scope`. Applies to every auto-prefix kind (figure, equation, table, exercise, proof:*). Closes QuantEcon/mystmd#27.
