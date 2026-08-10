import { describe, expect, it } from 'vitest';
import { mystParse } from 'myst-parser';
import { proofDirective } from '../src';

describe('proof directive', () => {
  it('proof directive parses', async () => {
    const content = '```{prf:proof} Proof Title\nProof content\n```';
    const expected = {
      type: 'root',
      children: [
        {
          type: 'mystDirective',
          name: 'prf:proof',
          args: 'Proof Title',
          value: 'Proof content',
          position: {
            start: {
              line: 1,
              column: 1,
            },
            end: {
              line: 3,
              column: 1,
            },
          },
          children: [
            {
              type: 'proof',
              kind: 'proof',
              enumerated: false,
              children: [
                {
                  type: 'admonitionTitle',
                  children: [
                    {
                      type: 'text',
                      value: 'Proof Title',
                      position: {
                        start: {
                          line: 1,
                          column: 1,
                        },
                        end: {
                          line: 1,
                          column: 1,
                        },
                      },
                    },
                  ],
                },
                {
                  type: 'paragraph',
                  children: [
                    {
                      type: 'text',
                      value: 'Proof content',
                      position: {
                        start: {
                          line: 2,
                          column: 1,
                        },
                        end: {
                          line: 2,
                          column: 1,
                        },
                      },
                    },
                  ],
                  position: {
                    end: {
                      column: 1,
                      line: 2,
                    },
                    start: {
                      column: 1,
                      line: 2,
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const output = mystParse(content, {
      directives: [proofDirective],
    });
    expect(output).toEqual(expected);
  });
  it.each([
    ['proof', false],
    ['prf:proof', false],
    ['proof:proof', false],
    ['prf:theorem', true],
    ['proof:theorem', true],
    ['prf:lemma', true],
    ['prf:algorithm', true],
  ])('%s defaults enumerated: %s', (name, enumerated) => {
    const output = mystParse('```{' + name + '}\ncontent\n```', {
      directives: [proofDirective],
    });
    const proof = (output as any).children[0].children[0];
    expect(proof.type).toBe('proof');
    expect(proof.enumerated).toBe(enumerated);
  });
  it('prf:proof can opt back in with enumerated: true', () => {
    const output = mystParse('```{prf:proof}\n:enumerated: true\ncontent\n```', {
      directives: [proofDirective],
    });
    const proof = (output as any).children[0].children[0];
    expect(proof.enumerated).toBe(true);
  });
  it('nonumber still disables numbering on theorem kinds', () => {
    const output = mystParse('```{prf:theorem}\n:nonumber: true\ncontent\n```', {
      directives: [proofDirective],
    });
    const proof = (output as any).children[0].children[0];
    expect(proof.enumerated).toBe(false);
  });

  it('parses proof directive without prf: prefix', async () => {
    const content = '```{proof} Proof Title\nProof content\n```';
    const output = mystParse(content, {
      directives: [proofDirective],
    });
    const proof = (output as any).children[0].children[0];
    expect(proof.type).toEqual('proof');
    expect(proof.kind).toEqual(undefined);
  });

  it('parses proof:theorem the same as prf:theorem', async () => {
    const content = '```{proof:theorem} Theorem Title\nTheorem content\n```';
    const output = mystParse(content, {
      directives: [proofDirective],
    });
    const theorem = (output as any).children[0].children[0];
    expect(theorem.type).toEqual('proof');
    expect(theorem.kind).toEqual('theorem');
  });
});
