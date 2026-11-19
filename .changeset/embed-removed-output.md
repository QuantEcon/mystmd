---
'myst-cli': patch
---

An embed of a cell (`{embed}`, `![](#label)` or `{figure} #label`) now shows the cell's output when the output is removed on its own page with the `remove-output` tag, and the embedded image is written to the build. Removed code and removed cells stay removed, and the source page is unchanged.
