import { proofDirective } from 'myst-ext-proof';
import type { UpgradeRule } from '../rule.js';

const PROOF_KINDS = new Set(
  [proofDirective.name, ...(proofDirective.alias ?? [])]
    .filter((name) => name.startsWith('prf:'))
    .map((name) => name.slice('prf:'.length)),
);

/**
 * A proof kind written with capitals, `{prf:Theorem}`, becomes `{prf:theorem}`
 *
 * Sphinx accepts any case; mystmd knows the lower-case names only. An unknown
 * kind is left untouched.
 */
export const proofKind: UpgradeRule = {
  name: 'proof-kind',
  run(lines, api) {
    api.doc.blocks
      .filter((block) => block.kind === 'directive' && /^prf:/i.test(block.name ?? ''))
      .forEach((block) => {
        const name = block.name!;
        const lower = name.toLowerCase();
        if (name === lower) return;
        if (!PROOF_KINDS.has(lower.slice('prf:'.length))) {
          api.skip(block.open, `{${name}} is not a known proof kind, left untouched`);
          return;
        }
        const before = lines[block.open];
        const after = before.replace(`{${name}}`, `{${lower}}`);
        api.change(block.open, before, after);
        api.replace(block.open, block.open + 1, [after]);
      });
  },
};
