---
"myst-cli": patch
---

`myst upgrade` gains rules for links to labelled targets, `{only}`, scaled images, `{youtube}`, capitalised proof kinds, `{any}` and the `{bibliography}` argument. An `{any}` to a project document becomes a link to the file, as `{doc}` does, and an `{any}` target that is neither a project label, a project document nor reachable through the intersphinx mapping fails.
