import { posix } from 'node:path';
import type { UpgradeRule } from '../rule.js';

function normalize(path: string) {
  return posix.normalize(path).replace(/^\.\//, '');
}

/**
 * `{bibliography} path.bib` loses its argument: in mystmd the project lists
 * its bibliography files in `myst.yml`
 *
 * When the project's bibliography is known and lacks a file the directive
 * named, the rule says so; it never edits the config.
 */
export const bibliographyArgument: UpgradeRule = {
  name: 'bibliography-argument',
  run(lines, api) {
    api.doc.blocks
      .filter((block) => block.name === 'bibliography' && block.argument.trim())
      .forEach((block) => {
        const before = lines[block.open];
        const after = `${block.indent}${block.marker}{bibliography}`;
        api.change(block.open, before, after);
        api.replace(block.open, block.open + 1, [after]);
        const { bibliography, path } = api.context;
        if (!bibliography) return;
        const listed = new Set(bibliography.map(normalize));
        block.argument
          .trim()
          .split(/\s+/)
          .map((file) =>
            normalize(
              file.startsWith('/') ? file.slice(1) : posix.join(posix.dirname(path ?? ''), file),
            ),
          )
          .filter((file) => !listed.has(file))
          .forEach((file) => {
            api.notice(
              block.open,
              `${file} is not in the project bibliography: add it to project.bibliography in myst.yml`,
            );
          });
      });
  },
};
