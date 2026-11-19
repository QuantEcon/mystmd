---
"myst-cli": patch
"mystmd": patch
---

Add `myst upgrade`, which upgrades a Jupyter Book 1 project without prompting: `--syntax-only`, `--dry-run`, `--report <file>` (JSON) and `--no-backup`, failing without writing anything when a construct cannot be converted. The syntax upgrade gains a rule framework with project context (page path, files, labels, bibliography) and a report, and rules for `{doc}` links, the notebook logo header, plain `{cite}` to `{cite:p}`, `:hide-output: false`, and the `no-execute` tag. `:hide-output:` is deleted for `false`, `False` or `FALSE`, and a `{doc}` to a page that is not in the project fails. `myst init` now stops on a failed rule: it lists every failure and writes nothing, not even a default `myst.yml` or a `.gitignore`. An already-converted glossary is no longer rewritten.
