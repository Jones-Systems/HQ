/**
 * Reference letters use bijective base 26: A..Z, AA..AZ, BA.. and so on.
 * A letter is assigned once from a monotonic index and stored on its
 * annotation; it is never recomputed from list position.
 */
export function letterForIndex(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('Letter index must be a non-negative integer');
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function indexForLetter(letter: string): number {
  if (!/^[A-Z]{1,6}$/u.test(letter)) throw new RangeError('Invalid reference letter');
  let n = 0;
  for (const char of letter) n = n * 26 + (char.charCodeAt(0) - 64);
  return n - 1;
}
