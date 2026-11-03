# HQ backend services

Each service owns its domain’s data. Keep databases, backups and endpoint
configuration outside the HQ source repository. Source availability does not
install, deploy or connect a running service; those operations remain separate.

| Service | Source and launch | Available interface | Contracts |
| --- | --- | --- | --- |
| Planner | [planner/](planner/README.md); run `python3 -m planning --data /path/outside/HQ/planning.sqlite3 --port 8765` from `services/planner` after creating the external data directory | Single board with typed dates, item/history reads, revision-guarded mutations, settings, import/export and backups. API 2 advertises `items.batch_create`, `requests.replay` and `hq-references-v1`. | [Planner API](planner/README.md#planner-api); [engineering specification](../docs/engineering-specs/hq-agent-cli.md). [Golden HTTP exchanges and HQ-reference vectors](planner/contract/README.md) are checked against the real disposable service. |
| HQ Social | [social/](social/README.md); run `python3 -m social_service --data /path/outside/HQ/social --port 8766` from `services/social` after creating the external data directory | A clean-room implementation of the Social workspace contract for local and disposable use: brands, versioned drafts with HQ reference links and timed planning slots, run history, and eight reference workbench analyzers run one at a time in a network-denied worker. Advertises `hq-editorial-timebox-v1` (with zone data) and `hq-references-v1`. Live collection, posting and account connection do not exist. | [HQ Social service contract v1](../docs/engineering-specs/backend-assessment-social-20261103.md#hq-social-service-contract-v1-target); [golden HTTP exchanges](social/contract/README.md) are checked against the real disposable service. |
| Fieldnotes | External, compatible Social service; source is not imported here | Deployment-specific external interface; no HQ-owned launch command is supplied here. HQ's Social adapter speaks the same wire contract to it and to the HQ Social service | No Fieldnotes contract is published in this directory; the HQ Social service contract above is HQ's own. |

Planner uses Python’s standard library and includes its legacy web UI. It has
no npm build step. The agent client lives separately in
[tools/hq-cli](../tools/hq-cli/README.md), where `--planner-url` overrides
`HQ_PLANNER_URL`. Endpoint access accepts HTTPS or loopback HTTP. Neither
service discovery nor a Planner date schedules execution.

HQ references persist in Planner and render as snapshots in its legacy UI.
The Work live adapter and desktop connection remain follow-on work. No combined service process,
unified database or shared endpoint-configuration platform is introduced.

Run the Planner checks serially from `services/planner`, after checking host
capacity:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -t tests
node --test --test-concurrency=1 'tests/*.test.mjs'
```

The [service README](planner/README.md#tests) describes their synthetic fixtures
and cleanup. These local commands do not claim root CI adoption or installed
service verification.

Run the HQ Social checks the same way, from `services/social`:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -t tests
```

The [Social service README](social/README.md#tests) describes its scratch handling. The `HQ Social service`
workflow runs this command; its required status is an integration-owner decision.
