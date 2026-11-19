import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { createUpgradeReport, upgradeContent } from './syntax.js';
import type { UpgradeContext } from './syntax.js';

type TestFile = {
  cases: TestCase[];
};

type ExpectedIssue = {
  line: number;
  rule: string;
  message?: string;
};

type TestCase = {
  title: string;
  /** What the rules know about the project; the page defaults to `page.md` */
  context?: UpgradeContext;
  source: string;
  /** The upgraded document, or nothing when the document is unchanged */
  result: string | undefined;
  /** Each failure, with its line in the source; none when not given */
  failures?: ExpectedIssue[];
  /** Each skip, with its line in the source; none when not given */
  skips?: ExpectedIssue[];
  /** Each notice, with its line in the source; none when not given */
  notices?: ExpectedIssue[];
};

const file = 'syntax.yml';

const testYaml = fs.readFileSync(path.join(__dirname, file)).toString();
const cases = (yaml.load(testYaml) as TestFile).cases;

function expectIssues(actual: { line: number; rule: string; message: string }[], expected = []) {
  expect(actual.length).toBe(expected.length);
  expected.forEach(({ line, rule, message }: ExpectedIssue, index: number) => {
    expect(actual[index]).toMatchObject({ line, rule });
    if (message) expect(actual[index].message).toContain(message);
  });
}

describe('upgradeSyntax', () => {
  test.each(cases.map((c): [string, TestCase] => [c.title, c]))(
    '%s',
    async (_, { context, source, result, failures, skips, notices }) => {
      const pageContext = { path: 'page.md', ...context };
      const sourceLines = source.split(/\r\n|\r|\n/);
      const resultLines = result?.split(/\r\n|\r|\n/);
      const report = createUpgradeReport();
      const transformedLines = await upgradeContent([...sourceLines], {
        context: pageContext,
        report,
      });
      expect(transformedLines).toEqual(resultLines);
      expectIssues(report.failures, failures as any);
      expectIssues(report.skips, skips as any);
      expectIssues(report.notices, notices as any);
      if (resultLines) {
        // Every rule is idempotent: the upgraded document upgrades to itself
        const again = createUpgradeReport();
        expect(
          await upgradeContent([...resultLines], { context: pageContext, report: again }),
        ).toBeUndefined();
        expect(again.failures.length).toBe(failures?.length ?? 0);
      }
    },
  );
});
