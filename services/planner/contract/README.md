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
run, exact-byte repeat, revision/order conflicts, rejected reference targets,
retained replay, safe resend, and an indeterminate replay with no baseline.
Retention eviction and rollback are additionally covered by store tests.

From `services/planner`, after admission to one serial test process:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 contract/generate.py --check
```

To deliberately update fixtures after reviewing a contract change, run
`python3 -B contract/build_vectors.py` and
`python3 -B contract/generate.py`, inspect the diff, and refresh `SHA256SUMS`.
The `planner-service` group in `tests/check-groups.json` checks both regeneration
drift and hashes. It retains every existing Python and Node regression test.

The generator owns `tests/.scratch/wire-*`, its disposable SQLite database,
and its server subprocess. Context cleanup closes connections, terminates and
waits for the child (with a bounded kill fallback), and removes scratch after
success, exceptions and interrupt cancellation. It never launches an installed
service, reads endpoint configuration, or connects to a live store. It is a
real loopback HTTP test; the other HTTP unit tests remain socket-free.
