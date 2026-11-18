import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostId, isRelativePath, rootId } from '../src/contract.ts';
import { canonicalize, jcsSha256Hex, sha256Hex, utf8 } from '../src/jcs.ts';
import { deriveSourceProjectId, normalizeRemote, parseRepoIdentity } from '../src/identity.ts';

test('JCS matches RFC 8785 golden vectors', () => {
  // RFC 8785 section 3.2.2 example input and canonical output.
  const input = JSON.parse('{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}');
  assert.equal(canonicalize(input), '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}');
  // Property order is by UTF-16 code units, not locale.
  assert.equal(canonicalize({ '\u20ac': 1, '\r': 2, '1': 3, 'a': 4, '\ud83d\ude00': 5, '\u0080': 6 }), '{"\\r":2,"1":3,"a":4,"\u0080":6,"\u20ac":1,"\ud83d\ude00":5}');
  assert.equal(canonicalize(-0), '0');
});

test('JCS rejects values outside I-JSON', () => {
  assert.throws(() => canonicalize(Number.NaN));
  assert.throws(() => canonicalize(Number.POSITIVE_INFINITY));
  assert.throws(() => canonicalize('\ud800'));
  assert.throws(() => canonicalize(new Date(0)));
  assert.throws(() => canonicalize([undefined]));
  assert.throws(() => canonicalize(1n));
});

test('SHA-256 golden vectors and SourceProjectId derivation are stable and independent of titles', async () => {
  assert.equal(await sha256Hex(utf8('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const host = hostId('host-a');
  const root = rootId('projects');
  const id = await deriveSourceProjectId(host, root, 'apps/site');
  const expected = createHash('sha256').update('{"hostId":"host-a","relativePath":"apps/site","rootId":"projects"}').digest('hex');
  assert.equal(id, expected);
  assert.equal(id, await jcsSha256Hex({ rootId: 'projects', relativePath: 'apps/site', hostId: 'host-a' }));
  // Different host or root yields a different identity even for the same path.
  assert.notEqual(id, await deriveSourceProjectId(hostId('host-b'), root, 'apps/site'));
  assert.notEqual(id, await deriveSourceProjectId(host, rootId('archive'), 'apps/site'));
  await assert.rejects(deriveSourceProjectId(host, root, '../escape'));
});

test('relative paths reject absolute, parent and empty segments', () => {
  for (const ok of ['.', 'a', 'a/b', 'a.b/c-d']) assert.equal(isRelativePath(ok), true, ok);
  for (const bad of ['', '/a', 'a//b', 'a/../b', './a', 'a\\b', 'C:/x', ' a', 'a/']) assert.equal(isRelativePath(bad), false, bad);
});

test('remote normalization drops credentials and folds scp syntax; it never merges anything by itself', () => {
  assert.equal(normalizeRemote('https://user:secret@GitHub.com/Org/Repo.git'), 'github.com/Org/Repo');
  assert.equal(normalizeRemote('git@github.com:Org/Repo.git'), 'github.com/Org/Repo');
  assert.equal(normalizeRemote('ssh://git@example.test:2222/team/app/'), 'example.test:2222/team/app');
  assert.equal(normalizeRemote('https://example.test/a/b?token=x#frag'), 'example.test/a/b');
  assert.equal(normalizeRemote('file:///tmp/repo'), null);
  assert.equal(normalizeRemote('not a remote'), null);
  assert.equal(normalizeRemote('https://example.test/../x'), 'example.test/x');
  for (const normalized of ['github.com/Org/Repo', 'example.test:2222/team/app']) assert.equal(normalizeRemote(normalized), normalized, 'idempotent');
});

test('repo identity is strictly validated', () => {
  assert.deepEqual(parseRepoIdentity({ localOnly: true }), { localOnly: true });
  assert.deepEqual(parseRepoIdentity({ normalizedRemote: 'github.com/o/r', rootCommit: 'a'.repeat(40), localOnly: false }),
    { normalizedRemote: 'github.com/o/r', rootCommit: 'a'.repeat(40), localOnly: false });
  assert.equal(parseRepoIdentity({ normalizedRemote: 'https://u:p@github.com/o/r.git', localOnly: false }), null);
  assert.equal(parseRepoIdentity({ normalizedRemote: 'github.com/o/r', localOnly: true }), null);
  assert.equal(parseRepoIdentity({ localOnly: false, extra: 1 }), null);
  assert.equal(parseRepoIdentity({ rootCommit: 'xyz', localOnly: false }), null);
});
