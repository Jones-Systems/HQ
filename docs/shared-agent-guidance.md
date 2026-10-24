# Shared agent guidance in HQ

HQ consumes shared roles from [Universal Agents](https://github.com/Jones-Systems/Universal-Agents) and working methods from [Codex V3](https://github.com/Jones-Systems/Codex-V3). HQ keeps its own product instructions, local roles and integration decisions. Shared roles are generated from UA's `v3-roles` profile; do not edit their delivered copies.

## Startup

Codex reads the checkout's `AGENTS.md`; `CLAUDE.md` directs Claude to that same agreement. Both route to the ignored `.agents/shared-guidance.md`. Delivery owns this file's `codex-agent-core` block and binds it to an immutable V3 snapshot. The root agreements stay tracked, portable and free of host paths. The delivered bridge and role files stay local to the enrolled checkout.

Missing delivery is reported as unavailable. An instruction route does not establish that a native provider loaded it, and file readiness does not refresh running sessions. Verify a fresh session's actual startup separately before claiming runtime adoption.

## Enrollment boundary

The foundation integration owner must accept this source change. Live enrollment additionally requires the integrated host-tooling delivery component and an exact approved `ua.delivery-envelope/v1`. Those operations were held when this proposal was prepared; merging this document does not activate them. See the upstream [delivery guide](https://github.com/Jones-Systems/Universal-Agents/blob/main/docs/delivery.md) and [host component](https://github.com/Jones-Systems/host-tooling/pull/34).

Use project scope for each exact HQ checkout. Linked worktrees and fresh clones require their own registration and materialization; repository membership alone does not enroll them. Preserve existing worktree owners. Before enrollment, verify the checkout, source revision, provider versions and absence of conflicting local files. Do not write another lane's checkout without a reconciled scope assignment.

The initial profile has 13 shared roles for each selected runtime. It does not install shared skills into native skill discovery. The bridge supplies source guidance and its skill pointers; HQ-specific roles and skills retain HQ ownership.

## Registration recipe

The operator supplies absolute `HQ_ROOT`, `DELIVERY_HOME`, `UA_DELIVER` and `HQ_ENVELOPE` paths, unique `HQ_CODEX_ID` and `HQ_CLAUDE_ID` consumer IDs, and verified `CODEX_VERSION`, `CLAUDE_VERSION`, `HOST_CLASS` and `ARCHITECTURE`. These are inputs to the existing UA CLI, not a new HQ installer. Do not record machine paths or approval records in this public repository.

Initialize the approved delivery home once through its host-owned route, binding the canonical UA origin and `codex-v3` guidance origin. Reuse an existing matching home. The envelope must cover both exact consumer IDs, mounts, automatic adoption and `claim: none`. Only the Codex consumer owns the bridge, with `claim: none` and a null block preimage. Existing unowned files are a collision, not permission to replace them.

The source adapters used for qualification declare Codex `0.149.0` (with `0.163.0` rendering compatibility) and Claude `2.1.302`. These are qualification inputs, not assertions about an installed provider. An unsupported real version needs upstream qualification before live adoption.

After approval and verification, execute from the assigned HQ checkout:

```sh
mkdir -p "$HQ_ROOT/.agents"
"$UA_DELIVER" --home "$DELIVERY_HOME" register \
  --consumer "$HQ_CODEX_ID" --scope project --project-root "$HQ_ROOT" \
  --profile v3-roles --runtime codex --runtime-version "$CODEX_VERSION" \
  --host-class "$HOST_CLASS" --architecture "$ARCHITECTURE" \
  --mount ".codex/agents=$HQ_ROOT/.codex/agents" --guidance codex-v3 \
  --bridge-path "$HQ_ROOT/.agents/shared-guidance.md" --bridge-claim none \
  --adoption auto --claim none --target-class live --envelope "$HQ_ENVELOPE"
"$UA_DELIVER" --home "$DELIVERY_HOME" register \
  --consumer "$HQ_CLAUDE_ID" --scope project --project-root "$HQ_ROOT" \
  --profile v3-roles --runtime claude --runtime-version "$CLAUDE_VERSION" \
  --host-class "$HOST_CLASS" --architecture "$ARCHITECTURE" \
  --mount ".claude/agents=$HQ_ROOT/.claude/agents" --guidance codex-v3 \
  --adoption auto --claim none --target-class live --envelope "$HQ_ENVELOPE"
"$UA_DELIVER" --home "$DELIVERY_HOME" update --latest
"$UA_DELIVER" --home "$DELIVERY_HOME" update --source codex-v3 --latest
"$UA_DELIVER" --home "$DELIVERY_HOME" ready --consumer "$HQ_CODEX_ID" --require-current
"$UA_DELIVER" --home "$DELIVERY_HOME" ready --consumer "$HQ_CLAUDE_ID" --require-current
```

Do not re-register after an unknown or partial result. Inspect the index, consumer state and event journal first. The envelope is a coverage record; its existence does not grant authority.

## Updates and acceptance

Registered automatic consumers adopt relevant updates when the delivery CLI processes a source event. An approved canonical-clone hook can request that update after a local fetch changes `origin/main`. A remote merge alone does not fetch source, update HQ or enroll new worktrees. Hook installation has its own exact approval envelope. Without hooks, run explicit updates through the same approved operator route. No polling service or startup generator is installed by HQ.

For each enrolled checkout, require current file readiness for both runtime consumers, verify the 13 generated roles per runtime and the bridge's snapshot binding, and confirm tracked HQ files remain unchanged. Check `ready --runtime codex --cwd "$HQ_ROOT" --require-current` and the corresponding Claude command to qualify discovery by checkout. Keep unrelated HQ-specific roles tracked; the ignore rules reserve only the shared `codex-v3-*` filenames.

Then use an authorized fresh provider session to confirm its root instructions, shared snapshot and native role discovery. A `session_binding: none` or `native_discovery: unattested` result remains a runtime evidence gap. Existing sessions need separately authorized refresh; this proposal does not restart them.

Recovery uses the upstream state journal and verified adoption history. Preview an exact prior content digest before adopting it. Detach verifies owned hashes and preserves unrelated files; unregister only after successful detach. Drift or unknown effects hold further mutation. No global instructions, global agents, services or other repositories are changed by this HQ source proposal.
