"""Drive the real wave compiler over the committed spec, round by round, with labeled fixture results.

Usage: PYTHONPATH=<Codex V3 checkout>/src python3 rounds.py <HQ checkout> <commit> held|activated [actual]
With "actual", round 1 consumes the root- and T1-accepted lane results (ACTUAL below; changed_paths from git,
filtered to each write_scope) and later rounds are fixture projections.
"""
import hashlib, json, subprocess, sys
from pathlib import Path
from codex_v3.orchestration import RevisionIdentity
from codex_v3.model_selection import ModelName, ModelRequest, ModelSelectionMode, ModelTuple, ReasoningEffort
from codex_v3.specification_plan import AffectedCheckCatalogBinding, CHECK_CATALOG_SCHEMA
from codex_v3.specification_refs import ArtifactRequest
from codex_v3.wave_compiler import (CompileReadyWaveRequest, ExplicitActivationEvidence, ActivationState,
    NormalizedResultField, NormalizedTaskResult, ResultCompletion, ResultField, TaskModelRequest,
    WaveCompilerError, compile_ready_wave, plan_and_blob_for_request)

repo = Path(sys.argv[1]).resolve(); rev = RevisionIdentity(sys.argv[2]); activate = sys.argv[3] == 'activated'
from_actual = sys.argv[4:] == ['actual']
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
R1 = 'cfdab378e28940662ddb6e731264afca164a1957'
# task: (commit, diff base, branch, PR, root acceptance record)
ACTUAL = {
    'bind-foundation': ('35f9a3e1fd0561335737ea47f6a680e74a5ad0e7', None, 'work/hq-foundation', None, 'sharedPrerequisites'),
    'workspace-skeleton': (R1, 'ff5ad79', 'work/hq-social-work-plan', 3, 'sharedPrerequisites'),
    'ui-kit': ('935dedf78e04a2697bdc02d85864546948ffcb8c', R1, 'work/hq-ui-kit', 24, 'candidateAcceptanceEvents[1]'),
    'social-core': ('83dafc50ef9e4e1b296baf2f1f9ad2d6b3115f04', R1, 'work/hq-social-content', 25, 'candidateAcceptanceEvents[0]'),
    'social-content': ('5f5df2a7c3881091a6d038be32fdee5ab23ef5e2', R1, 'work/hq-social-content', 25, 'candidateAcceptanceEvents[3]'),
    'social-workbench': ('bffd43343e83173f6814db7771ca6f5b70536494', R1, 'work/hq-social-workbench', 27, 'candidateAcceptanceEvents[5]'),
    'social-domain': ('9735b741e94baad83d9f7dc5f3bb8ce9c3778b2d', R1, 'work/hq-social-domain', 29, 'candidateAcceptanceEvents[6]'),
    'work-core': ('a8c791a877bd28974894e1d48913d0ff460b6f00', R1, 'work/hq-work-planner', 26, 'candidateAcceptanceEvents[2]'),
    'work-views': ('8a3261dbd0d98dac3553ffc594cd8a88cc4dcb04', R1, 'work/hq-work-planner', 26, 'candidateAcceptanceEvents[4]'),
    'work-board': ('3ca74d7479283d8ac7acf7c363bd262f34578ed4', R1, 'work/hq-work-board', 28, 'candidateAcceptanceEvents[7]'),
    'work-domain': ('3426da769ca6a5cf1ba561859039b14fc745457a', '3ca74d7479283d8ac7acf7c363bd262f34578ed4', 't3/work-domain-integration', 31, 't1-fan-in:work-domain'),
    'domain-integration': ('562986d1852d7b4ef101ff6d4c9340c3751c727a', '55b751ba96936631e6302811eed9cf81ea904db3', 't3/social-work-domain-assembly', 36, 'root-acceptance:S'),
}
def actual_result(task):
    key = task.task_ref.split('#task.')[1].removesuffix('.001')
    commit, diff_base, branch, pr, record = ACTUAL[key]
    paths = []
    if diff_base:
        paths = subprocess.run(['git', '-C', str(repo), 'diff', '--name-only', f'{diff_base}..{commit}', '--', *task.write_scope],
                               capture_output=True, text=True, check=True).stdout.split()
    vals = {'summary': c(f'{key} root-accepted for bounded fixture/source use at {commit}; checks author-reported'),
            'changed_paths': c(paths), 'evidence_refs': c([f'root-supervision:{record}'] + ([f'https://github.com/Jones-Systems/HQ/pull/{pr}'] if pr else [])),
            'produced_refs': c(list(task.produces)), 'candidate_binding': c({'commit': commit, 'branch': branch, 'pr': pr}),
            'deferred_findings': c(['worknote.hq-social-work#ctx.deferred-findings.001'])}
    fields = tuple(NormalizedResultField(ResultField(f), vals[f]) for f in (x.value for x in task.result_fields))
    who = 't1' if record.startswith('t1-') else 'root'
    return NormalizedTaskResult(rev, blob, task.task_ref, f'{who}-acceptance:{key}@{commit[:12]}', ResultCompletion.COMPLETE, True, fields), len(paths)
evidence = tuple(ExplicitActivationEvidence(rev, blob, t.task_ref, t.activation.predicate_ref, f'projection-fixture:{t.task_ref}:assumed-satisfied',
           ActivationState.SATISFIED) for t in plan.tasks if t.activation.predicate_ref) if activate else ()
by = {t.task_ref: t for t in plan.tasks}; done = []; n = 0; rnd = 0
print(f'spec blob {blob} at {rev.oid}; mode={"all explicit predicates fixture-satisfied" if activate else "explicit predicates unbound"}'
      f'{"; round 1 consumes actual root-accepted results" if from_actual else ""}')
if from_actual:
    for t in plan.tasks:
        k = t.task_ref.split('#task.')[1].removesuffix('.001')
        if k in ACTUAL:
            res, npaths = actual_result(t); done.append(res)
            print(f'  actual {k}: {res.result_ref} changed_paths_in_scope={npaths}')
def collisions(refs):
    out = []
    for i, a in enumerate(refs):
        for b in refs[i + 1:]:
            for x in by[a].write_scope:
                for y in by[b].write_scope:
                    if x == y or x.startswith(y + '/') or y.startswith(x + '/'):
                        out.append((a.split('#task.')[1], b.split('#task.')[1], x, y))
    return out
while True:
    rnd += 1
    finished = {d.task_ref for d in done}
    active = {e.task_ref for e in evidence}
    expected = tuple(sorted(t for t, v in by.items() if t not in finished and set(v.dependencies) <= finished
                     and (v.activation.predicate_ref is None or t in active)))
    if not expected: break
    try:
        out = compile_ready_wave(CompileReadyWaveRequest(repository_root=repo, source_revision=rev, spec_request=spec,
              catalog_binding=cat, accepted_results=tuple(done), activation_evidence=evidence,
              model_requests=tuple(TaskModelRequest(rev, t, MR, MR.sha256) for t in expected)))
    except WaveCompilerError as exc:
        print(f'round {rnd}: expected={[r.split("#task.")[1] for r in expected]} typed stop {exc.code}: {exc}')
        break
    assert out.ready_task_refs == expected, (out.ready_task_refs, expected)
    print(f'round {rnd}: ready={[r.split("#task.")[1] for r in out.ready_task_refs]} capsule_drafts={len(out.capsule_drafts)} assignment_drafts={len(out.assignment_drafts)} rendered_bytes={out.total_rendered_bytes} writer_collisions={collisions(out.ready_task_refs)}')
    for d in out.capsule_drafts:
        ctx = sum(v.content_bytes for v in d.resolved_context)
        print(f'  capsule {d.task_ref.split("#task.")[1]}: context_bytes={ctx} capsule_json_bytes={len(d.to_json().encode()) if isinstance(d.to_json(), str) else len(json.dumps(d.to_json()).encode())} sha256={d.capsule_sha256}')
    for r in out.ready_task_refs:
        n += 1; done.append(result(by[r], n))
held = sorted(set(by) - {d.task_ref for d in done})
print('unreleased:', [h.split('#task.')[1] for h in held])
