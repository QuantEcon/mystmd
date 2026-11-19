import { describe, expect, test } from 'vitest';
import { upgradeConfig, validateJupyterBookConfig } from './config.js';

describe('upgradeConfig', () => {
  test('bibtex_bibfiles becomes the project bibliography', () => {
    const data = validateJupyterBookConfig({
      title: 'A book',
      bibtex_bibfiles: ['_static/quant-econ.bib', 'references.bib'],
    });
    expect(data).toBeDefined();
    const { project } = upgradeConfig(data!);
    expect(project.bibliography).toEqual(['_static/quant-econ.bib', 'references.bib']);
  });
  test('no bibtex_bibfiles leaves the bibliography unset', () => {
    const data = validateJupyterBookConfig({ title: 'A book' });
    const { project } = upgradeConfig(data!);
    expect(project.bibliography).toBeUndefined();
  });
});
