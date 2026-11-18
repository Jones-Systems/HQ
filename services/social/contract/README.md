# HQ Social wire contract

These synthetic fixtures describe the HQ-owned Social service. They contain no owner records and no
configured service address. Consumers may copy the JSON files and pin their SHA-256 values from `SHA256SUMS`;
this directory is a contract artifact, not a runtime library.

`exchanges/*.json` have schema `hq.social.exchange/v1`. They are ordered captures of actual requests and
responses from a disposable HTTP service, covering every route and the key errors: the workspace snapshot,
samples, brand creation, draft create, update (links and slot preserved), conflict, unknown field, repeated
link, clearing links and slot, a queued run, a succeeded and a failed run, an invalid run, a token mismatch,
refused host and origin, a wrong content type, 405 and 404. `request.body_utf8` preserves the exact request
bytes. Response headers keep native security, cache and content-length behavior; HTTP `Date` and `Server` are
excluded as transport metadata. The fixture host header is the synthetic allowlisted `localhost`; the real
connection uses a freshly allocated loopback port that is never recorded.

The fixture process controls only volatile values: ids count up as 32-digit hexadecimal numbers, the clock
advances one second per read from `2026-01-15T12:00:00+00:00`, and the workspace token is the visible value
`synthetic-workspace-token`. No status, error, version, ordering or body is rewritten. Runs use
`contract_worker.py`, a deterministic stand-in for the analyzer worker, so the exchanges pin the wire contract
and do not change when an analyzer does. The capture waits for each run to finish before the next call, which
is what keeps the clock sequence stable.

From `services/social`, after admission to one serial test process:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -B contract/generate.py --check
```

To update the fixtures deliberately after reviewing a contract change, run `python3 -B contract/generate.py`,
inspect the diff and commit the exchanges with the refreshed `SHA256SUMS`. `tests/test_contract.py` regenerates
the exchanges, compares them byte for byte, checks the manifest, and verifies that the disposable service and
its scratch directory are cleaned up after success, failure and interrupt.
