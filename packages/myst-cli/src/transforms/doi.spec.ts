import { describe, expect, it } from 'vitest';
import { VFile } from 'vfile';
import type { ISession } from '../session/types';
import { Session } from '../session';
import { resolveDOIAsBibTeX, resolveDOIAsCSLJSON, transformLinkedDOIs } from './dois';
import fixtures from './fixtures/doi.json';

const PRIESTLEY_1972_CSL_JSON = [
  {
    'container-title': 'Monthly Weather Review',
    author: [
      { given: 'C. H. B.', family: 'PRIESTLEY' },
      { given: 'R. J.', family: 'TAYLOR' },
    ],
    DOI: '10.1175/1520-0493(1972)100<0081:otaosh>2.3.co;2',
    type: 'article-journal',
    issue: '2',
    issued: { 'date-parts': [[1972, 2]] },
    page: '81-92',
    publisher: 'American Meteorological Society',
    title: 'On the Assessment of Surface Heat Flux and Evaporation Using Large-Scale Parameters',
    volume: '100',
  },
];

const BARTELS_1997_CSL_JSON = [
  {
    DOI: '10.1002/(sici)1096-987x(199709)18:12<1450::aid-jcc3>3.0.co;2-i',
    // ISSN: '0192-8651',
    // URL: 'http://dx.doi.org/10.1002/(SICI)1096-987X(199709)18:12<1450::AID-JCC3>3.0.CO;2-I',
    author: [
      {
        family: 'Bartels',
        given: 'Christian',
      },
      {
        family: 'Karplus',
        given: 'Martin',
      },
    ],
    'container-title': 'Journal of Computational Chemistry',
    issue: '12',
    issued: {
      'date-parts': [[1997]],
    },
    page: '1450-1462',
    publisher: 'Wiley',
    title:
      'Multidimensional adaptive umbrella sampling: Applications to main chain and side chain peptide conformations',
    type: 'article-journal',
    volume: '18',
  },
];

/**
 * A session whose fetch serves recorded doi.org responses (see fixtures/doi.json),
 * so these tests do not depend on live doi.org availability — the parsing
 * pipeline (content negotiation, BibTeX/CSL-JSON parsing) is still exercised.
 *
 * The fixture is selected by DOI substring; the URL must still be consumable
 * by fetch (i.e. a valid URL after WHATWG normalization), which preserves the
 * "strange characters" coverage of the original live tests.
 */
function mockDOISession(): ISession {
  const mockFetch = async (input: URL | RequestInfo, init?: RequestInit) => {
    // Throws on malformed URLs, like real fetch would
    const url = new URL(typeof input === 'string' ? input : ((input as Request).url ?? input));
    const doiPath = decodeURIComponent(url.pathname).toLowerCase();
    const fixture =
      doiPath.includes('10.1175') || doiPath.includes('cr3qwn')
        ? fixtures.priestley
        : doiPath.includes('10.1002')
          ? fixtures.bartels
          : undefined;
    if (!fixture) return { ok: false } as Response;
    const accept = new Headers(init?.headers as HeadersInit).get('Accept') ?? '';
    if (accept.includes('csl+json')) {
      return {
        ok: true,
        json: async () => fixture.csl,
        text: async () => JSON.stringify(fixture.csl),
      } as Response;
    }
    return {
      ok: true,
      text: async () => fixture.bibtex,
      json: async () => JSON.parse(fixture.bibtex),
    } as Response;
  };
  // A real Session keeps the stub aligned with the full ISession surface;
  // only fetch is overridden
  const session = new Session();
  session.fetch = mockFetch as ISession['fetch'];
  return session;
}

// Set TEST_LIVE_DOI=1 to run the same cases against live doi.org (e.g. to
// refresh fixtures or check for upstream data drift); CI uses the mock only.
const sessions: { name: string; makeSession: () => ISession }[] = [
  { name: 'recorded', makeSession: mockDOISession },
];
if (process.env.TEST_LIVE_DOI === '1') {
  sessions.push({ name: 'live doi.org', makeSession: () => new Session() });
}

sessions.forEach(({ name: sessionName, makeSession }) => {
  describe.each([
    { resolver: resolveDOIAsBibTeX, name: 'BibTeX' },
    { resolver: resolveDOIAsCSLJSON, name: 'CSL-JSON' },
  ])(`DOI Resolvers for $name (${sessionName})`, ({ resolver }) => {
    it('short DOI resolves', async () => {
      const data = await resolver(makeSession(), 'https://doi.org/cr3qwn');
      expect(data).toMatchObject(PRIESTLEY_1972_CSL_JSON);
    });
    it('url encoded DOI resolves', async () => {
      const data = await resolver(
        makeSession(),
        'https://doi.org/10.1175%2F1520-0493%281972%29100%3C0081%3AOTAOSH%3E2.3.CO%3B2',
      );
      expect(data).toMatchObject(PRIESTLEY_1972_CSL_JSON);
    });
    it('markdown link with strange characters resolves', async () => {
      const data = await resolver(
        makeSession(),
        'https://doi.org/10.1175/1520-0493(1972)100<0081:OTAOSH>2.3.CO;2',
      );
      expect(data).toMatchObject(PRIESTLEY_1972_CSL_JSON);
    });
    it('markdown link with strange characters resolves (sici DOI)', async () => {
      const data = await resolver(
        makeSession(),
        'https://doi.org/10.1002/(SICI)1096-987X(199709)18:12%3C1450::AID-JCC3%3E3.0.CO;2-I',
      );
      // Both of these are different depending on the resolver
      // The URL is encoded, the ISSN is actually different?!
      delete data?.[0].URL;
      delete data?.[0].ISSN;
      const dateParts = data?.[0].issued?.['date-parts']?.[0];
      if (dateParts && dateParts.length > 1) {
        // Remove the date-parts for the month.
        // The month `sept` is sometimes returned by crossref but only `sep` is parsed by citation-js.
        // This started showing up in April 2026.
        // For this test, just ensure the year is parsed correctly, which is what is shown in our UI and citation renderers.
        dateParts.pop();
      }
      expect(data).toMatchObject(BARTELS_1997_CSL_JSON);
    });
  });
});

describe('transformLinkedDOIs', () => {
  describe.each([
    {
      name: 'mybinder zenodo dataverse link',
      url: 'https://mybinder.org/v2/zenodo/10.7910/DVN/EOYZKH/',
    },
    {
      name: 'iopscience article link',
      url: 'https://iopscience.iop.org/article/10.3847/1538-3881/ace32f#ajace32ff10',
    },
    {
      name: 'frontiers article link',
      url: 'https://www.frontiersin.org/articles/10.3389/fonc.2018.00134/full#supplementary-material',
    },
  ])('$name', ({ url }) => {
    it('does not auto-cite by default', async () => {
      const mdast = {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'link',
                url,
                children: [{ type: 'text', value: 'article' }],
              },
            ],
          },
        ],
      };
      await transformLinkedDOIs(new Session(), new VFile(), mdast, {}, 'test.md');
      expect(mdast.children[0].children[0].type).toBe('link');
    });
  });
});
