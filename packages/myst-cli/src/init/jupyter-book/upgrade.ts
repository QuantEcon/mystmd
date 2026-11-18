import fs from 'node:fs/promises';

import { defined } from '../../utils/defined.js';
import yaml from 'js-yaml';
import type { Config } from 'myst-config';
import { upgradeConfig, validateJupyterBookConfig } from './config.js';
import { upgradeTOC, validateSphinxExternalTOC } from './toc.js';
import type { SyntaxUpgradePlan, UpgradeReport } from './syntax.js';
import {
  formatUpgradeIssues,
  planProjectSyntaxUpgrade,
  writeProjectSyntaxUpgrade,
} from './syntax.js';
import { fsExists } from '../../utils/fsExists.js';
import chalk from 'chalk';
import type { ISession } from '../../session/types.js';
import { defaultConfigFile } from '../../config.js';

export type JupyterBookUpgradePlan = {
  config: Config;
  syntax: SyntaxUpgradePlan;
};

/**
 * Work out the upgrade of a Jupyter Book: its configuration, its TOC and its syntax
 *
 * Nothing is written.
 *
 * @param session - session with logging
 */
export async function planJupyterBookUpgrade(session: ISession): Promise<JupyterBookUpgradePlan> {
  const config: Config = {
    version: 1,
    project: {},
  };

  // Does config file exist?
  if (!(await fsExists('_config.yml'))) {
    throw new Error(`${chalk.blue('_config.yml')} is a required Jupyter Book configuration file`);
  }
  const configContent = await fs.readFile('_config.yml', { encoding: 'utf-8' });
  const configData = validateJupyterBookConfig(yaml.load(configContent));
  if (defined(configData)) {
    session.log.info(`Migrating Jupyter Book configuration to ${chalk.blue('myst.yml')}`);

    // Update MyST configuration
    ({ site: config.site, project: config.project } = upgradeConfig(configData));
  }

  // Does TOC exist?
  if (!(await fsExists('_toc.yml'))) {
    throw new Error(`${chalk.blue('_toc.yml')} is a required Jupyter Book configuration file`);
  }
  const tocContent = await fs.readFile('_toc.yml', { encoding: 'utf-8' });
  const tocData = validateSphinxExternalTOC(yaml.load(tocContent));
  if (defined(tocData)) {
    session.log.info(`Migrating TOC to ${chalk.blue('myst.yml')}`);

    (config as any).project.toc = upgradeTOC(session, tocData);
  }

  config.site = config.site ?? {};
  config.site.options = config.site.options ?? {};

  // Ensure we enable folders
  session.log.debug(
    chalk.dim(`Setting ${chalk.blue('site.options.folders')} to ${chalk.blue('true')}`),
  );
  config.site.options.folders = true;

  // Upgrade legacy syntax
  const syntax = await planProjectSyntaxUpgrade(session, {
    bibliography: bibliographyList(config.project?.bibliography),
  });

  return { config, syntax };
}

/**
 * Write a Jupyter Book upgrade: the upgraded documents, the new config file,
 * and the old configuration files renamed so that they are hidden
 */
export async function writeJupyterBookUpgrade(
  session: ISession,
  configFile: string,
  plan: JupyterBookUpgradePlan,
  opts: { backup?: boolean } = {},
) {
  await writeProjectSyntaxUpgrade(session, plan.syntax, opts);

  // Write new myst.yml
  await fs.writeFile(configFile, yaml.dump(plan.config));

  await fs.rename('_config.yml', '._config.yml.bak');
  session.log.debug(
    chalk.dim(`Renamed ${chalk.blue('_config.yml')} to ${chalk.blue('._config.yml.bak')}`),
  );

  await fs.rename('_toc.yml', '._toc.yml.bak');
  session.log.debug(
    chalk.dim(`Renamed ${chalk.blue('_toc.yml')} to ${chalk.blue('._toc.yml.bak')}`),
  );
}

function syntaxFailureError(report: UpgradeReport) {
  return new Error(
    `${report.failures.length} construct(s) could not be upgraded, so no file was changed:\n${formatUpgradeIssues(
      report.failures,
    )}`,
  );
}

export async function upgradeJupyterBook(session: ISession, configFile: string) {
  const plan = await planJupyterBookUpgrade(session);
  if (plan.syntax.report.failures.length) {
    throw syntaxFailureError(plan.syntax.report);
  }
  await writeJupyterBookUpgrade(session, configFile, plan, { backup: true });
}

function bibliographyList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  return undefined;
}

export type UpgradeOptions = {
  /** Only upgrade the syntax of documents, even without a config file */
  syntaxOnly?: boolean;
  /** Report the upgrade without writing anything */
  dryRun?: boolean;
  /** Path of a JSON report to write */
  report?: string;
  /** Keep a `.<name>.bak` copy of each upgraded document (default `true`) */
  backup?: boolean;
};

/**
 * The JSON report of an upgrade
 */
export function upgradeReportJSON(
  report: UpgradeReport,
  opts: { mode: 'full' | 'syntax-only'; dryRun: boolean },
) {
  const rules: Record<string, number> = {};
  const files: Record<string, UpgradeReport['changes']> = {};
  report.changes.forEach((change) => {
    rules[change.rule] = (rules[change.rule] ?? 0) + 1;
    const path = change.file ?? '';
    files[path] = files[path] ?? [];
    files[path].push(change);
  });
  return {
    mode: opts.mode,
    dryRun: opts.dryRun,
    summary: {
      files: Object.keys(files).length,
      changes: report.changes.length,
      failures: report.failures.length,
      skips: report.skips.length,
      notices: report.notices.length,
      rules,
    },
    files: Object.entries(files).map(([path, changes]) => ({
      path,
      changes: changes.map(({ rule, cell, line, before, after }) => ({
        rule,
        cell,
        line,
        before,
        after,
      })),
    })),
    failures: report.failures,
    skips: report.skips,
    notices: report.notices,
  };
}

/**
 * Upgrade a Jupyter Book 1 project to MyST, without asking anything
 *
 * Without a config file, the configuration and the TOC are migrated too, as
 * `myst init` does; with one, or with `syntaxOnly`, only the documents are
 * upgraded. When any rule fails, every failure is reported, nothing is
 * written, and an error is thrown.
 *
 * @param session - session with logging
 * @param opts - the command options
 */
export async function upgrade(session: ISession, opts: UpgradeOptions = {}) {
  const configFile = defaultConfigFile(session, '.');
  const hasConfig = await fsExists(configFile);
  let full = !opts.syntaxOnly && !hasConfig;
  if (full && !(await fsExists('_config.yml'))) {
    session.log.info(
      `No ${chalk.blue('myst.yml')} and no ${chalk.blue('_config.yml')}: upgrading the syntax only`,
    );
    full = false;
  }
  const backup = opts.backup ?? true;

  let report: UpgradeReport;
  let write: () => Promise<void>;
  if (full) {
    const plan = await planJupyterBookUpgrade(session);
    report = plan.syntax.report;
    write = () => writeJupyterBookUpgrade(session, configFile, plan, { backup });
  } else {
    let bibliography: string[] | undefined;
    if (hasConfig) {
      const config = yaml.load(await fs.readFile(configFile, { encoding: 'utf-8' })) as any;
      bibliography = bibliographyList(config?.project?.bibliography) ?? [];
    }
    const plan = await planProjectSyntaxUpgrade(session, { bibliography });
    report = plan.report;
    write = () => writeProjectSyntaxUpgrade(session, plan, { backup });
  }

  const json = upgradeReportJSON(report, {
    mode: full ? 'full' : 'syntax-only',
    dryRun: !!opts.dryRun,
  });
  Object.entries(json.summary.rules)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([rule, count]) => {
      session.log.info(`${chalk.blue(rule)}: ${count} change(s)`);
    });
  session.log.info(
    `${json.summary.changes} change(s) in ${json.summary.files} file(s), ` +
      `${json.summary.skips} skipped, ${json.summary.failures} failure(s)`,
  );
  if (report.skips.length) {
    session.log.info(chalk.dim(formatUpgradeIssues(report.skips)));
  }
  if (report.notices.length) {
    session.log.warn(formatUpgradeIssues(report.notices));
  }
  if (opts.report) {
    await fs.writeFile(opts.report, `${JSON.stringify(json, null, 2)}\n`);
    session.log.info(`Wrote the upgrade report to ${chalk.blue(opts.report)}`);
  }
  if (report.failures.length) {
    throw syntaxFailureError(report);
  }
  if (opts.dryRun) {
    session.log.info(`Dry run: no file was changed`);
    return;
  }
  await write();
}
