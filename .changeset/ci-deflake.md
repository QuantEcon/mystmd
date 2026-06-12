---
"myst-cli": patch
---

DOI resolver tests run against recorded doi.org fixtures instead of the live network (set TEST_LIVE_DOI=1 to also run the live variants), and the end-to-end runner supports per-case vitest retries for the known-environmental Jupyter execution tests.
