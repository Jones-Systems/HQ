export const CONTEXT_CHARS = 32;

export interface QuoteMatch {
  readonly start: number;
  readonly end: number;
}

/** Characters of agreement between `a`'s end and `b`'s end. */
function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

/**
 * Finds the occurrence of `quote` in `text` whose surrounding context best
 * matches the captured prefix/suffix. Ties resolve to the earliest occurrence.
 */
export function locateQuote(text: string, quote: string, prefix: string, suffix: string): QuoteMatch | null {
  if (quote.length === 0) return null;
  let best: QuoteMatch | null = null;
  let bestScore = -1;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    const before = text.slice(Math.max(0, at - prefix.length), at);
    const after = text.slice(at + quote.length, at + quote.length + suffix.length);
    const score = commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix);
    if (score > bestScore) {
      best = { start: at, end: at + quote.length };
      bestScore = score;
    }
  }
  return best;
}

/** Context around a selection, as stored in a text anchor. */
export function quoteContext(text: string, start: number, end: number): { prefix: string; suffix: string } {
  return {
    prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: text.slice(end, end + CONTEXT_CHARS),
  };
}
