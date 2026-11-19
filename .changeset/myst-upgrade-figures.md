---
"myst-cli": patch
---

`myst upgrade` gains rules for `mystnb` figure metadata on code cells, `{glue:figure}` (adding `remove-output` to the producing cell when the glue call has `display=False`), and the `{raw} html` iframes and tables other than the notebook header; any other `{raw}` block now fails the upgrade.
