---
"myst-cli": patch
---

`myst upgrade` gains rules for `mystnb` figure metadata on code cells, `{glue:figure}`, and the `{raw} html` iframes and tables other than the notebook header; any other `{raw}` block now fails the upgrade.
