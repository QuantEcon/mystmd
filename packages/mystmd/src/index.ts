#!/usr/bin/env node
import 'core-js/actual'; // This adds backwards compatible functionality for various CLIs

// This suppresses the punycode deprecation warning
// https://github.com/jupyter-book/mystmd/issues/1166
const { emit: originalEmit } = process;
function suppressor(event: string, ...args: any[]) {
  const error = args[0] as Error;
  return event === 'warning' && error.name === 'DeprecationWarning'
    ? false
    : (originalEmit as (...args: any[]) => boolean).apply(process, [event, ...args]);
}
(process as any).emit = suppressor;

import { Command } from 'commander';
import version from './version.js';
import qeVersion from './qe-version.js';
import { makeBuildCLI } from './build.js';
import { makeCleanCLI } from './clean.js';
import { makeInitCLI, addDefaultCommand } from './init.js';
import { makeStartCLI } from './start.js';
import { makeTemplatesCLI } from './templates.js';
import chalk from 'chalk';
import { readableName, isWhiteLabelled } from 'myst-cli';

const program = new Command();

if (isWhiteLabelled()) {
  program.description(
    `${readableName()} is powered by ${chalk.blue('mystmd')}. See https://mystmd.org for more information.`,
  );
}

program.addCommand(makeInitCLI(program));
program.addCommand(makeBuildCLI(program));
program.addCommand(makeStartCLI(program));
program.addCommand(makeCleanCLI(program));
program.addCommand(makeTemplatesCLI(program));
// QuantEcon fork: append the `qe-vN` build identifier when present.
// Source of truth lives in `quantecon/VERSION.yml` and is baked in at
// build time via `scripts/copy-qe-version.mjs`; if the file is absent
// (e.g. an upstream-only checkout) `qeVersion` is `null` and the
// version string falls back to the upstream-only form.
const versionLabel = qeVersion ? `v${version} (${qeVersion})` : `v${version}`;
program.version(versionLabel, '-v, --version', `Print the current version of ${readableName()}`);
program.option('-d, --debug', 'Log out any errors to the console');
program.option(
  '--config <config-file>',
  'Use an alternate YAML config file, named relative to the project directory',
);
addDefaultCommand(program);
program.parse(process.argv);
