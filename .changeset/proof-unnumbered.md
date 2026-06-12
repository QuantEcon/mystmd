---
"myst-ext-proof": patch
---

The bare `proof` / `prf:proof` directive now defaults to `enumerated: false`, matching the LaTeX amsthm `\begin{proof}` convention — a proof is pinned to the theorem it proves and does not get its own number. Theorem-like kinds (`prf:theorem`, `prf:lemma`, …) are unchanged, and `:enumerated: true` opts a proof back in.
