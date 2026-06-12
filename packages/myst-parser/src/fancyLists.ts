import type MarkdownIt from 'markdown-it';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.js';
import type Token from 'markdown-it/lib/token.js';

/**
 * Pandoc-style "fancy lists": ordered lists whose markers are letters or roman
 * numerals (`a.`, `B)`, `iv.`), optionally wrapped in parentheses (`(i)`), with
 * the start number inferred from the first marker.
 *
 * Adapted from markdown-it-fancy-lists v1.3.2 by Moxio (MIT licensed)
 * https://github.com/Moxio/markdown-it-fancy-lists
 *
 * Modifications from the original:
 * - adds the Pandoc "TwoParens" form `(i)` / `(a)` / `(1)`, which the original
 *   deliberately excludes; the surrounding parentheses are part of the marker
 *   and lists with `(x)`, `x)` and `x.` markers do not continue one another
 * - records the marker numbering style and delimiter on the
 *   `ordered_list_open` token (`meta.style`, `meta.delimiter`) so the AST can
 *   round-trip the source notation to HTML/LaTeX/Typst renderers
 * - vendors the roman-numeral parsing (strict form) instead of depending on
 *   the `roman-numerals` package
 */

export type FancyListsOptions = {
  /** Allow an ordinal indicator (`1º.`), as in legal documents */
  allowOrdinal?: boolean;
  /** Allow multi-letter alphabetic markers (`aa.`) */
  allowMultiLetter?: boolean;
};

/** Numbering style of an ordered list, named after the CSS `list-style-type` values */
export type ListNumberingStyle =
  | 'decimal'
  | 'lower-alpha'
  | 'upper-alpha'
  | 'lower-roman'
  | 'upper-roman';

/** Delimiter following (or wrapping) an ordered list marker: `1.`, `1)` or `(1)` */
export type ListDelimiterStyle = 'period' | 'paren' | 'parens';

const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
const STRICT_ROMAN = /^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;

/**
 * Parse a strict-form roman numeral (already lowercased); returns null when invalid.
 */
function parseRoman(roman: string): number | null {
  if (!roman || !STRICT_ROMAN.test(roman)) return null;
  let total = 0;
  for (let i = 0; i < roman.length; i += 1) {
    const value = ROMAN_VALUES[roman[i]];
    const next = ROMAN_VALUES[roman[i + 1]];
    if (next && value < next) {
      total -= value;
    } else {
      total += value;
    }
  }
  return total;
}

type MarkerType = '0' | 'a' | 'A' | 'i' | 'I' | '#' | '*' | '-' | '+';
type Marker = {
  isOrdered: boolean;
  isRoman: boolean;
  isAlpha: boolean;
  type: MarkerType;
  bulletChar: string;
  hasOrdinalIndicator: boolean;
  delimiter: ')' | '.';
  isParenWrapped: boolean;
  start: number;
  posAfterMarker: number;
};

const MARKER_TYPE_TO_STYLE: Record<string, ListNumberingStyle> = {
  a: 'lower-alpha',
  A: 'upper-alpha',
  i: 'lower-roman',
  I: 'upper-roman',
};

export function markerMeta(marker: {
  type: string;
  delimiter: ')' | '.';
  isParenWrapped: boolean;
}) {
  const style: ListNumberingStyle = MARKER_TYPE_TO_STYLE[marker.type] ?? 'decimal';
  const delimiter: ListDelimiterStyle = marker.isParenWrapped
    ? 'parens'
    : marker.delimiter === ')'
      ? 'paren'
      : 'period';
  return { style, delimiter };
}

export function fancyListsPlugin(markdownIt: MarkdownIt, options?: FancyListsOptions): void {
  const isSpace = markdownIt.utils.isSpace;

  // Search `[-+*][\n ]`, returns next pos after marker on success
  // or null on fail.
  function parseUnorderedListMarker(
    state: StateBlock,
    startLine: number,
  ): { type: '*' | '-' | '+'; posAfterMarker: number } | null {
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];

    const marker = state.src.charCodeAt(pos);
    pos += 1;

    // Check bullet
    if (marker !== 0x2a /* * */ && marker !== 0x2d /* - */ && marker !== 0x2b /* + */) {
      return null;
    }

    if (pos < max) {
      const ch = state.src.charCodeAt(pos);
      if (!isSpace(ch)) {
        // " -test " - is not a list item
        return null;
      }
    }

    return {
      type: state.src.charAt(pos - 1) as '*' | '-' | '+',
      posAfterMarker: pos,
    };
  }

  // Search `^\(?(\d{1,9}|[a-z]{1,3}|[A-Z]{1,3}|[ivxlcdm]+|[IVXLCDM]+|#)([º°˚ᵒ]?)([.)])`,
  // returns marker info on success or null on fail.
  function parseOrderedListMarker(
    state: StateBlock,
    startLine: number,
  ): {
    bulletChar: string;
    hasOrdinalIndicator: boolean;
    delimiter: ')' | '.';
    isParenWrapped: boolean;
    posAfterMarker: number;
  } | null {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];

    // List marker should have at least 2 chars (digit + dot)
    if (start + 1 >= max) {
      return null;
    }

    const stringContainingNumberAndMarker = state.src.substring(start, Math.min(max, start + 12));

    const match =
      /^(\(?)(\d{1,9}|[a-z]{1,3}|[A-Z]{1,3}|[ivxlcdm]+|[IVXLCDM]+|#)([º°˚ᵒ]?)([.)])/.exec(
        stringContainingNumberAndMarker,
      );
    if (match === null) {
      return null;
    }
    const isParenWrapped = match[1] === '(';
    // An opening parenthesis must be closed by one: `(i)` is a marker, `(i.` is not
    if (isParenWrapped && match[4] !== ')') {
      return null;
    }

    let finalPos = start + match[0].length;
    const finalChar = state.src.charCodeAt(finalPos);

    //  requires one space after marker or eol
    if (isSpace(finalChar) === false && finalPos !== max) {
      return null;
    }

    // requires two spaces after a single capital letter and a period
    // (so "B. Russell was an English philosopher." is not a list)
    if (
      isCharCodeUppercaseAlpha(match[2].charCodeAt(0)) &&
      match[2].length === 1 &&
      match[3] === '' &&
      match[4] === '.'
    ) {
      finalPos += 1; // consume another space
      const charAfterSpace = state.src.charCodeAt(finalPos);
      if (isSpace(charAfterSpace) === false) {
        return null;
      }
    }

    return {
      bulletChar: match[2],
      hasOrdinalIndicator: match[3] !== '',
      delimiter: match[4] as ')' | '.',
      isParenWrapped,
      posAfterMarker: finalPos,
    };
  }

  function markTightParagraphs(state: StateBlock, idx: number) {
    let i: number, l: number;
    const level = state.level + 2;

    for (i = idx + 2, l = state.tokens.length - 2; i < l; i += 1) {
      if (state.tokens[i].level === level && state.tokens[i].type === 'paragraph_open') {
        state.tokens[i + 2].hidden = true;
        state.tokens[i].hidden = true;
        i += 2;
      }
    }
  }

  function isCharCodeDigit(charCode: number) {
    return charCode >= 0x30 /* 0 */ && charCode <= 0x39 /* 9 */;
  }

  function isCharCodeLowercaseAlpha(charCode: number) {
    return charCode >= 0x61 /* a */ && charCode <= 0x7a /* z */;
  }

  function isCharCodeUppercaseAlpha(charCode: number) {
    return charCode >= 0x41 /* A */ && charCode <= 0x5a /* Z */;
  }

  const convertAlphaMarkerToOrdinalNumber = (alphaMarker: string): number => {
    const lastLetterValue =
      alphaMarker.toLowerCase().charCodeAt(alphaMarker.length - 1) - 'a'.charCodeAt(0) + 1;
    if (alphaMarker.length > 1) {
      const prefixValue = convertAlphaMarkerToOrdinalNumber(
        alphaMarker.substring(0, alphaMarker.length - 1),
      );
      return prefixValue * 26 + lastLetterValue;
    }
    return lastLetterValue;
  };

  function analyseMarker(
    state: StateBlock,
    startLine: number,
    previousMarker: Marker | null,
    opts: FancyListsOptions,
  ): Marker | null {
    const orderedListMarker = parseOrderedListMarker(state, startLine);
    if (orderedListMarker !== null) {
      const bulletChar = orderedListMarker.bulletChar;
      const charCode = orderedListMarker.bulletChar.charCodeAt(0);

      if (isCharCodeDigit(charCode)) {
        return {
          isOrdered: true,
          isRoman: false,
          isAlpha: false,
          type: '0',
          start: Number.parseInt(bulletChar),
          ...orderedListMarker,
        };
      } else if (isCharCodeLowercaseAlpha(charCode) || isCharCodeUppercaseAlpha(charCode)) {
        const isLower = isCharCodeLowercaseAlpha(charCode);
        const isValidAlpha = bulletChar.length === 1 || opts.allowMultiLetter === true;
        // Pandoc rule: a first marker of "i"/"I" (or multi-letter roman) starts a
        // roman list; a single letter that merely *could* be roman ("c", "x")
        // starts an alphabetic list. Subsequent markers resolve by context.
        const preferRoman =
          (previousMarker !== null && previousMarker.isRoman === true) ||
          ((previousMarker === null || previousMarker.isAlpha === false) &&
            (bulletChar.toLowerCase() === 'i' || bulletChar.length > 1));
        const parsedRomanNumber = parseRoman(bulletChar.toLowerCase());

        if (parsedRomanNumber !== null && (isValidAlpha === false || preferRoman === true)) {
          return {
            isOrdered: true,
            isRoman: true,
            isAlpha: false,
            type: isLower ? 'i' : 'I',
            start: parsedRomanNumber,
            ...orderedListMarker,
          };
        } else if (isValidAlpha === true) {
          return {
            isOrdered: true,
            isRoman: false,
            isAlpha: true,
            type: isLower ? 'a' : 'A',
            start: convertAlphaMarkerToOrdinalNumber(bulletChar),
            ...orderedListMarker,
          };
        }
        return null;
      } else {
        return {
          isOrdered: true,
          isRoman: false,
          isAlpha: false,
          type: '#',
          start: 1,
          ...orderedListMarker,
        };
      }
    }
    const unorderedListMarker = parseUnorderedListMarker(state, startLine);
    if (unorderedListMarker !== null) {
      return {
        isOrdered: false,
        isRoman: false,
        isAlpha: false,
        bulletChar: '',
        hasOrdinalIndicator: false,
        delimiter: ')',
        isParenWrapped: false,
        start: 1,
        ...unorderedListMarker,
      };
    }
    return null;
  }

  function areMarkersCompatible(previousMarker: Marker, currentMarker: Marker) {
    return (
      previousMarker.isOrdered === currentMarker.isOrdered &&
      (previousMarker.type === currentMarker.type || currentMarker.type === '#') &&
      previousMarker.delimiter === currentMarker.delimiter &&
      previousMarker.isParenWrapped === currentMarker.isParenWrapped &&
      previousMarker.hasOrdinalIndicator === currentMarker.hasOrdinalIndicator
    );
  }

  const createFancyList = (opts: FancyListsOptions) => {
    return (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean => {
      // if it's indented more than 3 spaces, it should be a code block
      if (state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
      }

      // Special case:
      //  - item 1
      //   - item 2
      //    - item 3
      //     - item 4
      //      - this one is a paragraph continuation
      if (
        state.listIndent >= 0 &&
        state.sCount[startLine] - state.listIndent >= 4 &&
        state.sCount[startLine] < state.blkIndent
      ) {
        return false;
      }

      let isTerminatingParagraph = false;
      // limit conditions when list can interrupt
      // a paragraph (validation mode only)
      if (silent && state.parentType === 'paragraph') {
        // Next list item should still terminate previous list item;
        //
        // This code can fail if plugins use blkIndent as well as lists,
        // but I hope the spec gets fixed long before that happens.
        //
        if (state.tShift[startLine] >= state.blkIndent) {
          isTerminatingParagraph = true;
        }
      }

      let marker: Marker | null = analyseMarker(state, startLine, null, opts);
      if (marker === null) {
        return false;
      }
      if (marker.hasOrdinalIndicator === true && opts.allowOrdinal !== true) {
        return false;
      }

      // do not allow subsequent numbers to interrupt paragraphs in non-nested lists
      const isNestedList = state.listIndent !== -1;
      if (isTerminatingParagraph && marker.start !== 1 && isNestedList === false) {
        return false;
      }

      // If we're starting a new unordered list right after
      // a paragraph, first line should not be empty.
      if (isTerminatingParagraph) {
        if (state.skipSpaces(marker.posAfterMarker) >= state.eMarks[startLine]) return false;
      }

      // We should terminate list on style change. Remember first one to compare.
      const markerCharCode = state.src.charCodeAt(marker.posAfterMarker - 1);

      // For validation mode we can terminate immediately
      if (silent) {
        return true;
      }

      // Start list
      const listTokIdx = state.tokens.length;

      let token: Token;
      if (marker.isOrdered === true) {
        token = state.push('ordered_list_open', 'ol', 1);
        const attrs: [string, string][] = [];
        if (marker.type !== '0' && marker.type !== '#') {
          attrs.push(['type', marker.type]);
        }
        if (marker.start !== 1) {
          attrs.push(['start', marker.start.toString(10)]);
        }
        if (marker.hasOrdinalIndicator === true) {
          attrs.push(['class', 'ordinal']);
        }
        token.attrs = attrs;
        token.meta = { ...token.meta, ...markerMeta(marker) };
      } else {
        token = state.push('bullet_list_open', 'ul', 1);
      }

      const listLines: [number, number] = [startLine, 0];
      token.map = listLines;
      token.markup = String.fromCharCode(markerCharCode);

      //
      // Iterate list items
      //

      let nextLine = startLine;
      let prevEmptyEnd = false;
      const terminatorRules = state.md.block.ruler.getRules('list');

      const oldParentType = state.parentType;
      state.parentType = 'list';

      let tight = true;
      while (nextLine < endLine) {
        const nextMarker = analyseMarker(state, nextLine, marker, opts);
        if (nextMarker === null || areMarkersCompatible(marker, nextMarker) === false) {
          break;
        }
        let pos: number = nextMarker.posAfterMarker;
        const max = state.eMarks[nextLine];

        const initial =
          state.sCount[nextLine] + pos - (state.bMarks[startLine] + state.tShift[startLine]);
        let offset = initial;

        while (pos < max) {
          const ch = state.src.charCodeAt(pos);

          if (ch === 0x09) {
            offset += 4 - ((offset + state.bsCount[nextLine]) % 4);
          } else if (ch === 0x20) {
            offset += 1;
          } else {
            break;
          }

          pos += 1;
        }

        let contentStart = pos;

        let indentAfterMarker: number;
        if (contentStart >= max) {
          // trimming space in "-    \n  3" case, indent is 1 here
          indentAfterMarker = 1;
        } else {
          indentAfterMarker = offset - initial;
        }

        // If we have more than 4 spaces, the indent is 1
        // (the rest is just indented code block)
        if (indentAfterMarker > 4) {
          indentAfterMarker = 1;
        }

        // "  -  test"
        //  ^^^^^ - calculating total length of this thing
        const indent = initial + indentAfterMarker;

        // Run subparser & write tokens
        token = state.push('list_item_open', 'li', 1);
        token.markup = String.fromCharCode(markerCharCode);
        const itemLines = [startLine, 0] as [number, number];
        token.map = itemLines;

        // change current state, then restore it after parser subcall
        const oldTight = state.tight;
        const oldTShift = state.tShift[startLine];
        const oldSCount = state.sCount[startLine];

        //  - example list
        // ^ listIndent position will be here
        //   ^ blkIndent position will be here
        //
        const oldListIndent = state.listIndent;
        state.listIndent = state.blkIndent;
        state.blkIndent = indent;

        state.tight = true;
        state.tShift[startLine] = contentStart - state.bMarks[startLine];
        state.sCount[startLine] = offset;

        if (contentStart >= max && state.isEmpty(startLine + 1)) {
          // workaround for this case
          // (list item is empty, list terminates before "foo"):
          // ~~~~~~~~
          //   -
          //
          //     foo
          // ~~~~~~~~
          state.line = Math.min(state.line + 2, endLine);
        } else {
          state.md.block.tokenize(state, startLine, endLine);
        }

        // If any of list item is tight, mark list as tight
        if (!state.tight || prevEmptyEnd) {
          tight = false;
        }
        // Item become loose if finish with empty line,
        // but we should filter last element, because it means list finish
        prevEmptyEnd = state.line - startLine > 1 && state.isEmpty(state.line - 1);

        state.blkIndent = state.listIndent;
        state.listIndent = oldListIndent;
        state.tShift[startLine] = oldTShift;
        state.sCount[startLine] = oldSCount;
        state.tight = oldTight;

        token = state.push('list_item_close', 'li', -1);
        token.markup = String.fromCharCode(markerCharCode);

        nextLine = startLine = state.line;
        itemLines[1] = nextLine;
        contentStart = state.bMarks[startLine];

        if (nextLine >= endLine) {
          break;
        }

        //
        // Try to check if list is terminated or continued.
        //
        if (state.sCount[nextLine] < state.blkIndent) {
          break;
        }

        // if it's indented more than 3 spaces, it should be a code block
        if (state.sCount[startLine] - state.blkIndent >= 4) {
          break;
        }

        // fail if terminating block found
        let terminate = false;
        for (let i = 0, l = terminatorRules.length; i < l; i += 1) {
          if (terminatorRules[i](state, nextLine, endLine, true)) {
            terminate = true;
            break;
          }
        }
        if (terminate) {
          break;
        }

        marker = nextMarker;
      }

      // Finalize list
      if (marker.isOrdered) {
        token = state.push('ordered_list_close', 'ol', -1);
      } else {
        token = state.push('bullet_list_close', 'ul', -1);
      }
      token.markup = String.fromCharCode(markerCharCode);

      listLines[1] = nextLine;
      state.line = nextLine;

      state.parentType = oldParentType;

      // mark paragraphs tight if needed
      if (tight) {
        markTightParagraphs(state, listTokIdx);
      }

      return true;
    };
  };

  markdownIt.block.ruler.at('list', createFancyList(options ?? {}), {
    alt: ['paragraph', 'reference', 'blockquote'],
  });
}
