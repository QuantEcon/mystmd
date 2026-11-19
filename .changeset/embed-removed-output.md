---
'myst-cli': patch
---

An embed of a cell (`{embed}`, `![](#label)` or `{figure} #label`) now shows the cell's output, open, when its own page removes it with the `remove-output` tag or folds it with `hide-output`, and the embedded image is written to the build. Removed code and removed cells stay removed, and the source page is unchanged.
