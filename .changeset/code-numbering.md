---
"myst-transforms": patch
---

Code (enumerable code-block) numbering now matches the other enumerable kinds: `numbering.code.scope` applies the chapter/section prefix in book mode (e.g. `Listing 1.1`), and the caption noun follows the configured `numbering[kind].template` (e.g. `Listing %s`) instead of always using the built-in default, so captions and cross-references agree.
