"""Drive the real wave compiler over the committed spec, round by round, with labeled fixture results.

Usage: PYTHONPATH=<Codex V3 checkout>/src python3 rounds.py <HQ checkout> <commit> held|activated
"""
import hashlib, json, subprocess, sys
from pathlib import Path
from codex_v3.orchestration import RevisionIdentity
from codex_v3.model_selection import ModelName, ModelRequest, ModelSelectionMode, ModelTuple, ReasoningEffort
from codex_v3.specification_plan import AffectedCheckCatalogBinding, CHECK_CATALOG_SCHEMA
from codex_v3.specification_refs import ArtifactRequest
from codex_v3.wave_compiler import (CompileReadyWaveRequest, ExplicitActivationEvidence, ActivationState,
    NormalizedResultField, NormalizedTaskResult, ResultCompletion, ResultField, TaskModelRequest,
    compile_ready_wave, plan_and_blob_for_request)

repo = Path(sys.argv[1]); rev = RevisionIdentity(sys.argv[2]); activate = sys.argv[3] == 'activated'
def catalog_bytes(spec_text):
    """Projection catalog: the TOML fence in ctx.check-catalog.001 (a proposed delta, not tests/check-groups.toml)."""
    sec = spec_text.split('<!-- codex-section:begin id="spec.hq-social-work#ctx.check-catalog.001" -->', 1)[1].split('<!-- codex-section:end', 1)[0]
    return sec.split('```toml\n', 1)[1].split('```', 1)[0].encode()
spec_src = subprocess.run(['git', '-C', str(repo), 'show', f'{rev.oid}:docs/engineering-specs/hq-social-work.md'], capture_output=True, check=True).stdout
manifest = catalog_bytes(spec_src.decode())
groups = tuple(sorted(l.split('.',1)[1].rstrip(']') for l in manifest.decode().splitlines() if l.startswith('[groups.')))
cat = AffectedCheckCatalogBinding(CHECK_CATALOG_SCHEMA, rev, 'tests/check-groups.toml', hashlib.sha256(manifest).hexdigest(),
      groups, f'proposed:spec.hq-social-work#ctx.check-catalog.001@{rev.oid}')
TUP = ModelTuple(ModelName.CLAUDE_OPUS, ReasoningEffort.HIGH)
MR = ModelRequest(requested_mode=ModelSelectionMode.CLAUDE_FRONTIER, mode_scope='workstream:hq-social-work',
     selection_basis='explicit owner override: every lane claude-opus-5-5 high', intended_tuple=TUP, launch_request_tuple=TUP)
spec = ArtifactRequest('spec.hq-social-work')
base = CompileReadyWaveRequest(repository_root=repo, source_revision=rev, spec_request=spec, catalog_binding=cat)
plan, blob = plan_and_blob_for_request(base)
c = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
FIELD = {'summary': lambda t: c(f'{t} fixture complete'), 'changed_paths': lambda t: c([]), 'evidence_refs': lambda t: c(['fixture']),
         'produced_refs': lambda t: c([]), 'candidate_binding': lambda t: c({'fixture': True}), 'deferred_findings': lambda t: c([])}
def result(task, n):
    fields = tuple(NormalizedResultField(ResultField(f), FIELD[f](task.task_ref)) for f in (x.value for x in task.result_fields))
    return NormalizedTaskResult(rev, blob, task.task_ref, f'projection-fixture-{n}', ResultCompletion.COMPLETE, True, fields)
evidence = tuple(ExplicitActivationEvidence(rev, blob, t.task_ref, t.activation.predicate_ref, f'projection-fixture:{t.task_ref}:assumed-satisfied',
           ActivationState.SATISFIED) for t in plan.tasks if t.activation.predicate_ref) if activate else ()
by = {t.task_ref: t for t in plan.tasks}; done = []; n = 0; rnd = 0
print(f'spec blob {blob} at {rev.oid}; mode={"all explicit predicates fixture-satisfied" if activate else "explicit predicates unbound"}')
while True:
    rnd += 1
    finished = {d.task_ref for d in done}
    active = {e.task_ref for e in evidence}
    expected = tuple(sorted(t for t, v in by.items() if t not in finished and set(v.dependencies) <= finished
                     and (v.activation.predicate_ref is None or t in active)))
    if not expected: break
    out = compile_ready_wave(CompileReadyWaveRequest(repository_root=repo, source_revision=rev, spec_request=spec,
          catalog_binding=cat, accepted_results=tuple(done), activation_evidence=evidence,
          model_requests=tuple(TaskModelRequest(rev, t, MR, MR.sha256) for t in expected)))
    assert out.ready_task_refs == expected, (out.ready_task_refs, expected)
    print(f'round {rnd}: ready={[r.split("#task.")[1] for r in out.ready_task_refs]} capsule_drafts={len(out.capsule_drafts)} assignment_drafts={len(out.assignment_drafts)} rendered_bytes={out.total_rendered_bytes}')
    for r in out.ready_task_refs:
        n += 1; done.append(result(by[r], n))
held = sorted(set(by) - {d.task_ref for d in done})
print('unreleased:', [h.split('#task.')[1] for h in held])
