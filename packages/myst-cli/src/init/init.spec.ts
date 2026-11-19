import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Session } from '../session';
import { init } from './init';

vi.mock('inquirer', () => ({
  default: { prompt: vi.fn(async () => ({ upgrade: true, start: false })) },
}));

const BOOK: Record<string, string> = {
  '_config.yml': 'title: A book\n',
  '_toc.yml': 'format: jb-book\nroot: intro\n',
  'intro.md': '# Intro\n\n```{code-cell} ipython3\n:hide-output: true\n\nprint(1)\n```\n',
};

function listFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  fs.readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((name) => !name.split(path.sep).includes('.git'))
    .forEach((name) => {
      const file = path.join(dir, name);
      if (fs.statSync(file).isFile()) files[name] = fs.readFileSync(file, 'utf-8');
    });
  return files;
}

describe('myst init on a legacy Jupyter Book', () => {
  const cwd = process.cwd();
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myst-init-'));
    Object.entries(BOOK).forEach(([name, content]) => {
      fs.writeFileSync(path.join(dir, name), content);
    });
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stops on a failed rule and writes nothing', async () => {
    const before = listFiles(dir);
    await expect(init(new Session(), {})).rejects.toThrow(
      'intro.md:4: [hide-output-false] hide-output is "true"',
    );
    expect(listFiles(dir)).toEqual(before);
  });

  it('stops on a failed rule and writes no .gitignore in a git repository', async () => {
    execSync('git init -q && git add -A', { cwd: dir });
    const before = listFiles(dir);
    await expect(init(new Session(), {})).rejects.toThrow('could not be upgraded');
    expect(listFiles(dir)).toEqual(before);
    expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(false);
  });
});
