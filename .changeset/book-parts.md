---
"myst-toc": patch
"myst-cli": patch
---

Book-style parts: `section: parts` ParentEntry emits a Roman-numbered divider folder ("Part I — Theory") and wraps chapter groups. Chapter counter continues across part boundaries; children default to `section: chapters`. Project-level overrides via `numbering.parts.{format,label}`.
