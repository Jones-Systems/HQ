# HQ backend services

Each service owns its domain’s data. Keep databases, backups and endpoint
configuration outside the HQ source repository. Source availability does not
install, deploy or connect a running service; those operations remain separate.

| Service | Source and launch | Available interface | Contracts |
| --- | --- | --- | --- |
| Planner | [planner/](planner/README.md); run `python3 -m planning --data /path/outside/HQ/planning.sqlite3 --port 8765` from `services/planner` after creating the external data directory | Single board with typed dates, item/history reads, revision-guarded mutations, settings, import/export and backups. API 2 advertises `items.batch_create` and `requests.replay`. | [Planner API](planner/README.md#planner-api); [engineering specification](../docs/engineering-specs/hq-agent-cli.md). Golden HTTP exchanges and HQ-reference vectors under `planner/contract/` are planned and not yet available. |
| Fieldnotes | External Social service; source is not imported here | Deployment-specific external interface; no HQ-owned launch command is supplied here | No Fieldnotes contract is published in this directory. |

Planner uses Python’s standard library and includes its legacy web UI. It has
no npm build step. The agent client lives separately in
[tools/hq-cli](../tools/hq-cli/README.md), where `--planner-url` overrides
`HQ_PLANNER_URL`. Endpoint access accepts HTTPS or loopback HTTP. Neither
service discovery nor a Planner date schedules execution.

`hq-references-v1`, the Work live adapter and desktop connection are follow-on
work; they are not claimed by this import. No combined service process,
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
