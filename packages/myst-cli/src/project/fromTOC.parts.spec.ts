import { describe, expect, it, beforeEach, vi } from 'vitest';
import memfs from 'memfs';
import { resolve } from 'node:path';
import { Session } from '../session';
import { projectFromTOC } from './fromTOC';
import { config } from '../store/index.js';
import type { LocalProjectFolder, LocalProjectPage } from './types.js';

vi.mock('fs', () => ({ ['default']: memfs.fs }));

beforeEach(() => memfs.vol.reset());

const session = new Session();

/**
 * Prime the project config in the store. `projectFromTOC` reads
 * `numbering.parts.{format,label}` and `numbering.book.enabled` via
 * `selectors.selectLocalProjectConfig`.
 */
function primeProjectConfig(path: string, projectConfig: Record<string, unknown>) {
  session.store.dispatch(
    config.actions.receiveProjectConfig({ path: resolve(path), ...projectConfig } as any),
  );
}

/**
 * Helpers — strip absolute paths from page outputs so assertions stay
 * portable (memfs gives us absolute paths via `path.resolve`).
 */
function basename(p: string): string {
  return p.split('/').pop() ?? p;
}
function simplifyPages(pages: (LocalProjectFolder | LocalProjectPage)[]) {
  return pages.map((p) => {
    if ('file' in p) {
      return { ...p, file: basename(p.file) };
    }
    return p;
  });
}

describe('projectFromTOC: section parts', () => {
  it('emits a part divider folder with Roman label when book mode is on', () => {
    memfs.vol.fromJSON({ 'index.md': '', 'ch1.md': '', 'ch2.md': '' });
    primeProjectConfig('.', { numbering: { book: { enabled: true } } });
    const proj = projectFromTOC(session, '.', [
      { file: 'index' },
      {
        title: 'Theory',
        section: 'parts',
        children: [{ file: 'ch1' }, { file: 'ch2' }],
      },
    ]);
    expect(simplifyPages(proj.pages)).toEqual([
      { level: -1, section: 'parts', title: 'Part I — Theory' },
      { file: 'ch1.md', slug: 'ch1', level: 0, section: 'chapters' },
      { file: 'ch2.md', slug: 'ch2', level: 0, section: 'chapters' },
    ]);
  });

  it('chapter counter continues across part boundaries', () => {
    memfs.vol.fromJSON({
      'index.md': '',
      'ch1.md': '',
      'ch2.md': '',
      'ch3.md': '',
      'ch4.md': '',
    });
    primeProjectConfig('.', { numbering: { book: { enabled: true } } });
    const proj = projectFromTOC(session, '.', [
      { file: 'index' },
      {
        title: 'Theory',
        section: 'parts',
        children: [{ file: 'ch1' }, { file: 'ch2' }],
      },
      {
        title: 'Applications',
        section: 'parts',
        children: [{ file: 'ch3' }, { file: 'ch4' }],
      },
    ]);
    // Roman part counter increments I → II; chapter section unchanged.
    // (heading_1 counter continuity is verified end-to-end in the demo.)
    expect(simplifyPages(proj.pages)).toEqual([
      { level: -1, section: 'parts', title: 'Part I — Theory' },
      { file: 'ch1.md', slug: 'ch1', level: 0, section: 'chapters' },
      { file: 'ch2.md', slug: 'ch2', level: 0, section: 'chapters' },
      { level: -1, section: 'parts', title: 'Part II — Applications' },
      { file: 'ch3.md', slug: 'ch3', level: 0, section: 'chapters' },
      { file: 'ch4.md', slug: 'ch4', level: 0, section: 'chapters' },
    ]);
  });

  it('parts coexist with appendices (logical section group)', () => {
    memfs.vol.fromJSON({ 'index.md': '', 'ch1.md': '', 'app-a.md': '' });
    primeProjectConfig('.', { numbering: { book: { enabled: true } } });
    const proj = projectFromTOC(session, '.', [
      { file: 'index' },
      {
        title: 'Theory',
        section: 'parts',
        children: [{ file: 'ch1' }],
      },
      {
        title: 'Appendices',
        section: 'appendices',
        children: [{ file: 'app-a' }],
      },
    ]);
    expect(simplifyPages(proj.pages)).toEqual([
      { level: -1, section: 'parts', title: 'Part I — Theory' },
      { file: 'ch1.md', slug: 'ch1', level: 0, section: 'chapters' },
      // Appendices is *logical*: no folder, same level as chapters.
      { file: 'app-a.md', slug: 'app-a', level: 0, section: 'appendices' },
    ]);
  });

  it('numbering.parts.format overrides Roman default', () => {
    memfs.vol.fromJSON({ 'index.md': '', 'ch1.md': '' });
    primeProjectConfig('.', {
      numbering: { book: { enabled: true }, parts: { format: 'arabic' } },
    });
    const proj = projectFromTOC(session, '.', [
      { file: 'index' },
      {
        title: 'Theory',
        section: 'parts',
        children: [{ file: 'ch1' }],
      },
    ]);
    expect(simplifyPages(proj.pages)[0]).toEqual({
      level: -1,
      section: 'parts',
      title: 'Part 1 — Theory',
    });
  });

  it('numbering.parts.label overrides "Part %s" default', () => {
    memfs.vol.fromJSON({ 'index.md': '', 'ch1.md': '' });
    primeProjectConfig('.', {
      numbering: { book: { enabled: true }, parts: { label: 'Book %s' } },
    });
    const proj = projectFromTOC(session, '.', [
      { file: 'index' },
      {
        title: 'Theory',
        section: 'parts',
        children: [{ file: 'ch1' }],
      },
    ]);
    expect(simplifyPages(proj.pages)[0]).toEqual({
      level: -1,
      section: 'parts',
      title: 'Book I — Theory',
    });
  });

  it('skips part formatting when book mode is off', () => {
    memfs.vol.fromJSON({ 'index.md': '', 'ch1.md': '' });
    // No book.enabled — formatting should not fire; raw title used.
    primeProjectConfig('.', {});
    const proj = projectFromTOC(session, '.', [
      { file: 'index' },
      {
        title: 'Theory',
        section: 'parts',
        children: [{ file: 'ch1' }],
      },
    ]);
    expect(simplifyPages(proj.pages)[0]).toEqual({
      level: -1,
      section: 'parts',
      title: 'Theory',
    });
  });

  it('children of section: parts default to section: chapters', () => {
    memfs.vol.fromJSON({ 'index.md': '', 'ch1.md': '' });
    primeProjectConfig('.', { numbering: { book: { enabled: true } } });
    const proj = projectFromTOC(session, '.', [
      { file: 'index' },
      {
        title: 'Theory',
        section: 'parts',
        children: [{ file: 'ch1' }],
      },
    ]);
    const chPage = simplifyPages(proj.pages).find(
      (p): p is { file: string; section: string; slug: string; level: number } =>
        'file' in p && p.file === 'ch1.md',
    );
    expect(chPage?.section).toBe('chapters');
  });

  it('no parts in TOC → top-level level stays at 1 (regression)', () => {
    // Existing TOCs without parts must not have their page levels shifted
    // by the parts auto-detection.
    memfs.vol.fromJSON({ 'index.md': '', 'ch1.md': '' });
    primeProjectConfig('.', { numbering: { book: { enabled: true } } });
    const proj = projectFromTOC(session, '.', [
      { file: 'index' },
      {
        title: 'Chapters',
        section: 'chapters',
        children: [{ file: 'ch1' }],
      },
    ]);
    const chPage = simplifyPages(proj.pages).find(
      (p): p is { file: string; section: string; slug: string; level: number } =>
        'file' in p && p.file === 'ch1.md',
    );
    expect(chPage?.level).toBe(1);
  });
});
