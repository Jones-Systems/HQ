// The report is a closed-world value: only declared keys, finite non-negative numbers, booleans, null and
// members of fixed enumerations. Anything else is refused by both renderers.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { zeroReport } from '../collect.ts';
import { ReportRejected, buildReport, isClosedReport, renderJson, renderTable, type NamespaceReport, type Report } from '../report.ts';

function sample(): Report {
  const bl = zeroReport('bl', 'ready', 12.5, 3, 0);
  const appdev = zeroReport('appdev', 'unavailable', 1, 0, 0);
  return buildReport([{ ...bl, pages: 9 }, appdev], 1, 123456);
}

function mutate(change: (report: Record<string, any>) => void): unknown {
  const copy = JSON.parse(JSON.stringify(sample())) as Record<string, any>;
  change(copy);
  return copy;
}

describe('closed report', () => {
  test('a well-formed report is accepted and prints as JSON and as a table', () => {
    const report = sample();
    assert.ok(isClosedReport(report));
    const json = renderJson(report);
    assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(report)));
    assert.ok(json.endsWith('\n'));
    const table = renderTable(report);
    assert.match(table, /^wiki source validation \(aggregates only\), report v2, index rules v2\n/);
    assert.match(table, /\npages +9 +0\n/);
    assert.match(table, /\nstate +ready +unavailable\n/);
    assert.ok(table.endsWith('\n'));
  });

  test('the table omits rows that are zero everywhere and keeps the rest', () => {
    const table = renderTable(sample());
    assert.doesNotMatch(table, /nullOmissions/);
    assert.match(table, /gitProcesses\.refresh +3 +0/);
    assert.match(table, /rows that are zero for every namespace are omitted/);
  });

  const refusals: [string, (report: Record<string, any>) => void][] = [
    ['an extra top-level key', (r) => void (r['path'] = 1)],
    ['an extra Git process key', (r) => void (r['namespaces'][0]['gitProcesses']['argv'] = 1)],
    ['a missing Git lifecycle key', (r) => void delete r['namespaces'][0]['gitProcesses']['closed']],
    ['a string in a Git lifecycle counter', (r) => void (r['namespaces'][0]['gitProcesses']['failedStarts'] = 'private')],
    ['an extra key inside a namespace', (r) => void (r['namespaces'][0]['title'] = 3)],
    ['a missing key', (r) => void delete r['namespaces'][0]['pages']],
    ['a string where a number belongs', (r) => void (r['namespaces'][0]['pages'] = 'nine')],
    ['a string that is not in the enumeration', (r) => void (r['namespaces'][0]['ref'] = 'main')],
    ['a commit-like state', (r) => void (r['namespaces'][0]['state'] = '0123456789abcdef0123456789abcdef01234567')],
    ['a negative number', (r) => void (r['namespaces'][0]['pages'] = -1)],
    ['a non-finite number', (r) => void (r['namespaces'][0]['snapshotBytes'] = Number.POSITIVE_INFINITY)],
    ['a string in a per-reason table', (r) => void (r['namespaces'][0]['raw']['byReason']['not-text'] = 'x')],
    ['an extra reason key', (r) => void (r['namespaces'][0]['raw']['byReason']['some topic label'] = 1)],
    ['an unknown namespace', (r) => void (r['namespaces'][0]['namespace'] = 'secret')],
    ['more namespaces than exist', (r) => void r['namespaces'].push(r['namespaces'][0])],
    ['a query entry carrying text', (r) => void r['namespaces'][0]['search']['queries'].push({ ok: true, ms: 1, hits: 1, truncated: false, query: 'text' })],
    ['an object where null or a number belongs', (r) => void (r['namespaces'][0]['links']['internalResolutionPct'] = { value: 1 })],
  ];
  for (const [name, change] of refusals) {
    test(`refuses ${name}`, () => {
      const bad = mutate(change);
      assert.equal(isClosedReport(bad), false);
      assert.throws(() => renderJson(bad as Report), ReportRejected);
      assert.throws(() => renderTable(bad as Report), ReportRejected);
    });
  }

  test('accepts null only where the schema allows it', () => {
    const ok = mutate((r) => void (r['namespaces'][0]['links']['internalResolutionPct'] = null));
    assert.ok(isClosedReport(ok));
    assert.equal(isClosedReport(mutate((r) => void (r['namespaces'][0]['pages'] = null))), false);
  });

  test('the per-query list is bounded', () => {
    const queries: NamespaceReport['search']['queries'] = Array.from({ length: 100 }, () => ({ ok: true, ms: 0, hits: 0, truncated: false }));
    const report = sample();
    report.namespaces[0] = { ...(report.namespaces[0] as NamespaceReport), search: { queries } };
    assert.ok(isClosedReport(report));
    queries.push({ ok: true, ms: 0, hits: 0, truncated: false });
    assert.equal(isClosedReport(report), false, 'more than the declared maximum number of queries');
  });
});
