/**
 * Aggregate counters only. Tallies never hold file names, titles, URLs, IDs or any other source
 * value, so they are safe to publish as evidence.
 */
export class Tally {
  readonly counts = new Map<string, number>();
  add(name: string, by = 1): void { this.counts.set(name, (this.counts.get(name) ?? 0) + by); }
  get(name: string): number { return this.counts.get(name) ?? 0; }
  toJSON(): Record<string, number> {
    return Object.fromEntries([...this.counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
}
