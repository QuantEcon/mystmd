import { describe, expect, it } from 'vitest';
import { fillNumbering, validateNumbering } from './validators';

describe('fillNumbering', () => {
  it('empty numberings return empty', async () => {
    expect(fillNumbering({}, {})).toEqual({});
  });
  it('base numberings return base', async () => {
    expect(
      fillNumbering(
        {
          all: { enabled: true },
          enumerator: { template: '' },
          heading_6: { enabled: false },
        },
        {},
      ),
    ).toEqual({
      all: { enabled: true },
      enumerator: { template: '' },
      heading_6: { enabled: false },
    });
  });
  it('filler numberings return filler', async () => {
    expect(
      fillNumbering(
        {},
        {
          all: { enabled: true },
          enumerator: { template: '' },
          heading_6: { enabled: false },
        },
      ),
    ).toEqual({
      all: { enabled: true },
      enumerator: { template: '' },
      heading_6: { enabled: false },
    });
  });
  it('basic keys fill', async () => {
    expect(
      fillNumbering(
        {
          heading_1: { enabled: true, start: 2 },
          list: { enabled: true },
        },
        {
          enumerator: { template: '' },
          figure: { enabled: true, template: 'Fig. %s' },
          another: { enabled: true },
        },
      ),
    ).toEqual({
      enumerator: { template: '' },
      heading_1: { enabled: true, start: 2 },
      list: { enabled: true },
      figure: { enabled: true, template: 'Fig. %s' },
      another: { enabled: true },
    });
  });
  it('sub-keys fill', async () => {
    expect(
      fillNumbering(
        {
          heading_1: { enabled: true, start: 2 },
        },
        {
          heading_1: { template: 'Fig. %s' },
        },
      ),
    ).toEqual({
      heading_1: { enabled: true, start: 2, template: 'Fig. %s' },
    });
  });
  it('all overrides previous enabled values', async () => {
    expect(
      fillNumbering(
        {
          all: { enabled: false },
          heading_1: { enabled: true, start: 2 },
          list: { enabled: false },
          heading_3: { enabled: true },
        },
        {
          heading_2: { enabled: true, template: 'Fig. %s' },
          heading_3: { enabled: true },
        },
      ),
    ).toEqual({
      all: { enabled: false },
      heading_1: { enabled: true, start: 2 },
      list: { enabled: false },
      heading_2: { enabled: false, template: 'Fig. %s' },
      heading_3: { enabled: true },
    });
    expect(
      fillNumbering(
        {
          all: { enabled: true },
          heading_1: { enabled: true, start: 2 },
          list: { enabled: false },
          heading_3: { enabled: false },
        },
        {
          heading_2: { enabled: false, template: 'Fig. %s' },
          heading_3: { enabled: true },
        },
      ),
    ).toEqual({
      all: { enabled: true },
      heading_1: { enabled: true, start: 2 },
      list: { enabled: false },
      heading_2: { enabled: true, template: 'Fig. %s' },
      heading_3: { enabled: false },
    });
  });
});

describe('validateNumbering — counter aliasing (#34)', () => {
  const opts = () => ({ messages: {}, property: 'numbering' }) as any;

  it('passes through a bare proof-family counter target normalized to fully-qualified', () => {
    const out = validateNumbering({ 'proof:lemma': { counter: 'theorem' } }, opts());
    expect(out?.['proof:lemma']?.counter).toBe('proof:theorem');
  });

  it('leaves a fully-qualified target untouched', () => {
    const out = validateNumbering({ 'proof:lemma': { counter: 'proof:theorem' } }, opts());
    expect(out?.['proof:lemma']?.counter).toBe('proof:theorem');
  });

  it('warns and drops start/format/continue/scope/reset_on_part on an aliased kind', () => {
    const o = opts();
    const out = validateNumbering(
      {
        'proof:lemma': {
          counter: 'theorem',
          start: 5,
          format: 'roman',
          continue: true,
          scope: 'section',
          reset_on_part: true,
        },
      },
      o,
    );
    // counter alias is kept; owner-fields are dropped
    expect(out?.['proof:lemma']).toEqual({
      counter: 'proof:theorem',
      enabled: true,
    });
    const warns = o.messages.warnings ?? [];
    expect(warns.length).toBeGreaterThanOrEqual(5);
    for (const field of ['start', 'format', 'continue', 'scope', 'reset_on_part']) {
      expect(warns.some((m: any) => m.message.includes(`'${field}'`))).toBe(true);
    }
  });

  it('does NOT drop label or template on an aliased kind (rendering stays per-kind)', () => {
    const out = validateNumbering(
      {
        'proof:lemma': {
          counter: 'theorem',
          template: 'L. %s',
          label: 'Lemma %s',
        },
      },
      opts(),
    );
    expect(out?.['proof:lemma']?.template).toBe('L. %s');
    expect(out?.['proof:lemma']?.label).toBe('Lemma %s');
    expect(out?.['proof:lemma']?.counter).toBe('proof:theorem');
  });
});
