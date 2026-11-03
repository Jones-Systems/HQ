/** Fuzzy-ish matching for the command palette: word prefix first, then substring, then in-order letters. */

const normalise = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const words = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function isSubsequence(token: string, text: string): boolean {
  let at = 0;
  for (const char of text) if (char === token[at] && ++at === token.length) return true;
  return token.length === 0;
}

/** Score for one query token against one text, or null when the token does not appear. Higher is better. */
function tokenScore(token: string, text: string): number | null {
  const parts = words(text);
  let best: number | null = null;
  parts.forEach((word, index) => {
    if (!word.startsWith(token)) return;
    const score = 100 - Math.min(index, 8) * 4 + (word === token ? 12 : 0);
    if (best === null || score > best) best = score;
  });
  if (best !== null) return best;
  if (text.includes(token)) return 55;
  if (token.length >= 2 && isSubsequence(token, text)) return 24;
  return null;
}

/**
 * Score of `query` against a title plus extra search terms, or null when any query word is missing.
 * Every word must match; title matches count more than keyword matches. An empty query matches everything with 0.
 */
export function matchScore(query: string, title: string, keywords: readonly string[] = []): number | null {
  const tokens = words(normalise(query));
  if (tokens.length === 0) return 0;
  const head = normalise(title);
  const tail = normalise(keywords.join(' '));
  let total = 0;
  for (const token of tokens) {
    const inTitle = tokenScore(token, head);
    const found = tail ? tokenScore(token, tail) : null;
    const inKeywords = found === null ? null : found * 0.8;
    const score = inTitle === null ? inKeywords : inKeywords === null ? inTitle : Math.max(inTitle, inKeywords);
    if (score === null) return null;
    total += score;
  }
  // A title that begins with the query is the best possible answer.
  const starts = head.startsWith(tokens.join(' ')) ? 25 : 0;
  return total / tokens.length + starts;
}

export interface Rankable { readonly title: string; readonly keywords?: readonly string[] }

/** Matching items best first. Ties keep their original order; an empty query keeps every item in order. */
export function rank<T extends Rankable>(items: readonly T[], query: string): T[] {
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const score = matchScore(query, item.title, item.keywords);
    if (score !== null) scored.push({ item, score, index });
  });
  if (!query.trim()) return scored.map(entry => entry.item);
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(entry => entry.item);
}
