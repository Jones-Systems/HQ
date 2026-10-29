---
name: hq-cli
description: Use the HQ agent CLI to discover a configured Planner, read or change planning items, and reconcile uncertain writes. Applies to HQ Planner CLI tasks, not Design/Social operations or service installation.
---

Use this checkout's `tools/hq-cli/bin/hq` with Node 22.18 or newer. This source-local skill does not install a launcher or configure a service. See [the CLI guide](../../README.md) for flags, batch files and recovery details.

Discover with `hq capabilities`, `hq commands`, and `hq schema <command-id>`; pass the owner's configured `--planner-url` or `HQ_PLANNER_URL`. Every invocation emits one JSON `hq.cli.result/v1` envelope, including errors. Read the envelope and exit code together: `ok`, a stable `command` ID, `effect` (`none`, `applied`, `replayed`, `unknown` or `partial`), then `data` or `error.code`; writes also carry `request_id`. Single-request writes add a `replay` document, and sequential batches record each item's outcome. Exit codes: 0 success or replayed, 1 internal failure, 2 local usage/schema error, 3 service validation rejection, 4 revision/order conflict or reused request ID, 5 not found, 6 unavailable or unconfigured with no new write, 7 uncertain write outcome, 8 sequential batch partially applied. Unavailable domains are not working endpoints.

Before interpreting planning requests, use `hq planner boards` and `hq planner now --days 14`. The board is `planner:main`; areas are metadata, not separate boards. `--planned` means target date; `--due` means an independent deadline. Use the weekday mapping to choose exact dates for Friday or another weekday. Only today, tomorrow and +Nd are relative input tokens. Check the returned input/resolved/tz/today echo. Read back with separate `--date-kind target` and `--date-kind deadline` filters.

Get an item's revision before updates. Query the command schema for editable fields and use `--fields-file` for replacement arrays or explicit nulls. HQ references use `{kind:"hq", label, target}` with a full ReferenceEnvelope, no URL, and require the service feature `hq-references-v1`. Keep optional target provenance fields. Linking a target never dispatches work.

For several items, use a schema-valid `--spec-file`; atomic batches require `items.batch_create`. Choose `--mode sequential` explicitly for compatibility. Save the result or use a caller-owned `--intent-file`. Resume sequential work only with `--resume-from` the saved result so completed IDs remain accounted for.

On exit 7, preserve the exact replay document and use `hq planner replay --request-file RESULT --check` to look up the outcome. The resend form without `--check` uses the same endpoint, bytes, request ID and observed version. Never automatically retry or replace the request ID. If retention is indeterminate or the older service cannot safely replay, list and get the relevant items (or get settings), compare the observed state, and ask before a new change. A failed read or missing response does not prove that a write failed.
