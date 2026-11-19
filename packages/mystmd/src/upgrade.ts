import { Command, Option } from 'commander';
import { Session, upgrade, readableName } from 'myst-cli';
import { clirun } from './clirun.js';

export function makeUpgradeCLI(program: Command) {
  const command = new Command('upgrade')
    .description(
      `Upgrade a Jupyter Book 1 project to ${readableName()}, rewriting Sphinx and MyST-NB syntax without prompting`,
    )
    .addOption(
      new Option(
        '--syntax-only',
        'Only upgrade the syntax of documents, not the configuration (the default when a config file exists)',
      ).default(false),
    )
    .addOption(
      new Option('--dry-run', 'Report the upgrade without changing any file').default(false),
    )
    .addOption(
      new Option('--report <file>', 'Write a JSON report of every change, failure and skip'),
    )
    .addOption(
      new Option('--no-backup', 'Do not keep a .<name>.bak copy of each upgraded document'),
    )
    .action(clirun(Session, upgrade, program));
  return command;
}
