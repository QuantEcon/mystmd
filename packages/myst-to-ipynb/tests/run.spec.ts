import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { unified } from 'unified';
import writeIpynb from '../src';
import type { PageFrontmatter } from 'myst-frontmatter';
import type { IpynbOptions } from '../src';

type TestCase = {
  title: string;
  ipynb: Record<string, any>;
  mdast: Record<string, any>;
  frontmatter?: PageFrontmatter;
  options?: IpynbOptions;
};

type TestCases = {
  title: string;
  cases: TestCase[];
};

const casesList: TestCases[] = fs
  .readdirSync(__dirname)
  .filter((file) => file.endsWith('.yml'))
  .map((file) => {
    const content = fs.readFileSync(path.join(__dirname, file), { encoding: 'utf-8' });
    return yaml.load(content) as TestCases;
  });

casesList.forEach(({ title, cases }) => {
  describe(title, () => {
    test.each(cases.map((c): [string, TestCase] => [c.title, c]))(
      '%s',
      (_, { ipynb, mdast, frontmatter, options }) => {
        const pipe = unified().use(writeIpynb, frontmatter, options);
        pipe.runSync(mdast as any);
        const file = pipe.stringify(mdast as any);
        expect(JSON.parse(file.result)).toEqual(ipynb);
      },
    );
  });
});
