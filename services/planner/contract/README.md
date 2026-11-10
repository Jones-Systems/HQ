# Planner wire contract

These synthetic fixtures describe the HQ-owned Planner service. They contain
no owner records or configured service address. Consumers may copy the JSON
files and pin their SHA-256 values from `SHA256SUMS`; this directory is a
contract artifact, not a runtime library.

`reference-vectors.json` has schema `hq.planner.reference-vectors/v1`.
Each case supplies an `input` reference list and either its normalized
`expected` list or exact `errors`. Tests may inject `generated_entry_id` when
an entry has no ID. The HQ target contract matches `parseReference` and Work
validation at HQ revision `562986d1852d7b4ef101ff6d4c9340c3751c727a`:
closed keys, JavaScript trim and UTF-16 text limits, preserved optional
provenance, and slash-joined domain/kind/entity deduplication. Planner labels
keep the existing Python whitespace normalization and code-point limits.
Cross-language consumers should run the same vectors against their validator.
`tools/hq-cli/test/references.test.mjs` pins this file's SHA-256, so any
vector change must update that pin in the same integration.

`exchanges/*.json` have schema `hq.planner.exchange/v1`. They are ordered
captures of actual requests and responses from a disposable HTTP service.
`request.body_utf8` preserves the exact bytes used for request-ID fingerprints;
encode it as UTF-8. Headers retain native security, cache, content-length and
replay behavior. HTTP `Date` and `Server` are excluded as transport metadata.
The fixture host header is the synthetic allowlisted `localhost`; the actual
connection uses a freshly allocated loopback port that is never recorded.

The fixture process supplies monotonically increasing 16-digit hexadecimal
IDs and fixes store timestamps to `2026-01-15T12:00:00Z`. Those are the only
controlled application values. No response status, error, revision, state
version, position, target, body or replay result is rewritten. Field validation
is native HTTP 400; invalid imports and request-ID reuse are HTTP 422.
The captures cover reads, all item mutations, settings, atomic batch and dry
run, exact-byte repeat, revision/order conflicts, a malformed HQ reference,
an invalid import, retained replay, safe resend, and an indeterminate replay
with no baseline. The dry run and the real batch share one request ID, as the
CLI sends them: a dry run records no request.

After the final state, version and export readback, `28`–`39` capture
rejections that change no state:
- item read and mutation `not_found` (404);
- an invalid HQ target and invalid settings (400);
- a missing `X-Planning-Request` header (403), a non-JSON content type (415)
  and an unrecognized Host (421);
- an oversize declared `Content-Length` (413). The service refuses it before
  reading a body, so the capture sends none;
- replay `not_replayable` and an unobserved `sent_after_version` (400), and
  replay request-ID reuse (422);
- an unconfirmed replace import (400).

`40`–`42` then capture a merge import, which writes no backup, an examples
load and its `examples_present` conflict (409). Example dates follow the real
day, so only their counts are captured. Retention eviction, rollback and
replace imports, whose backup names use the real clock, are covered by store
tests.

From `services/planner`, after admission to one serial test process:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 contract/generate.py --check
```

`--check` names any drifted, missing or unexpected exchange files and fails
on them or on a `SHA256SUMS` mismatch.

Byte copies of these files are pinned outside this directory: the CLI's
vector hash above, and the Work live-adapter copy in
`modules/work/live/test/contract/` on the foundation line. Any byte change
here, including an added capture, needs those owners to re-pin it. To
deliberately update fixtures after reviewing a contract change, run `python3 -B contract/build_vectors.py` and then
`python3 -B contract/generate.py`. The second step rewrites the exchanges,
removes stale exchange files and refreshes `SHA256SUMS`. Inspect the diff.
The `planner-service` group in `tests/check-groups.json` checks byte-exact
regeneration drift and hashes through `tests/test_contract.py`. It retains
every existing Python and Node regression test.

The generator owns `tests/.scratch/wire-*`, its disposable SQLite database,
and its server subprocess. Context cleanup closes connections, terminates and
waits for the child (with a bounded kill fallback), and removes scratch after
success, exceptions and interrupt cancellation. It never launches an installed
service, reads endpoint configuration, or connects to a live store. It is a
real loopback HTTP test; the other HTTP unit tests remain socket-free.
