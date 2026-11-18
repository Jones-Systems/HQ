"""Validate the authored plan with hypothetical results; never launches work."""

from dataclasses import replace
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tomllib

from codex_v3.model_selection import ModelName, ModelRequest, ModelSelectionMode, ModelTuple, ReasoningEffort
from codex_v3.orchestration import RevisionIdentity
from codex_v3.specification_plan import AffectedCheckCatalogBinding, CHECK_CATALOG_SCHEMA
from codex_v3.specification_refs import ArtifactRequest
from codex_v3.wave_compiler import CompileReadyWaveRequest, NormalizedResultField, NormalizedTaskResult, ResultCompletion, ResultField, TaskModelRequest, compile_ready_wave, plan_and_blob_for_request

root = Path(__file__).resolve().parents[3]
revision = RevisionIdentity(sys.argv[1] if len(sys.argv) > 1 else subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip())
base = 'docs/planning-evidence/hq-expansion/'
def blob(path):
    return subprocess.check_output(['git', 'show', revision.oid + ':' + path], cwd=root)
catalog = blob(base + 'check-groups.projection.toml')
binding = AffectedCheckCatalogBinding(CHECK_CATALOG_SCHEMA, revision, 'tests/check-groups.toml', hashlib.sha256(catalog).hexdigest(), tuple(sorted(tomllib.loads(catalog.decode())['groups'])), base + 'catalog-projection.json:PROJECTION')
request = CompileReadyWaveRequest(root, revision, ArtifactRequest('spec.hq-expansion', 'docs/engineering-specs/hq-expansion.md'), binding)
plan, oid = plan_and_blob_for_request(request)
model = ModelTuple(ModelName.CLAUDE_OPUS, ReasoningEffort.HIGH)
fixture = ModelRequest(ModelSelectionMode.CLAUDE_FRONTIER, 'planning-fixture:hq-expansion', 'Nonlaunching supported placeholder only. Native builders must be Sonnet 5.5/high.', model, model)
# These are supplied scenario inputs. The real compiler derives and verifies readiness.
scenarios = [
    ['connector-lifecycle', 'reference-graph', 'requests-lifecycle', 'wiki-contract'],
    ['reference-packets', 'wiki-core', 'wiki-ui'],
    ['reference-producer', 'wiki-private-validation'],
    [],
]
accepted = []
rounds = []
for number, names in enumerate(scenarios, 1):
    refs = tuple(sorted('spec.hq-expansion#task.' + name + '.001' for name in names))
    models = tuple(TaskModelRequest(revision, ref, fixture, fixture.sha256) for ref in refs)
    result = compile_ready_wave(replace(request, accepted_results=tuple(accepted), model_requests=models))
    assert result.ready_task_refs == refs
    rounds.append({'round': number, 'ready': list(result.ready_task_refs), 'capsule_drafts': len(result.capsule_drafts), 'assignment_drafts': len(result.assignment_drafts), 'rendered_bytes': result.total_rendered_bytes})
    fields = tuple(NormalizedResultField(field, json.dumps('HYPOTHETICAL accepted predecessor; no implementation claim', separators=(',', ':'))) for field in (ResultField.SUMMARY, ResultField.EVIDENCE_REFS, ResultField.PRODUCED_REFS, ResultField.DEFERRED_FINDINGS))
    accepted.extend(NormalizedTaskResult(revision, oid, ref, 'planning-fixture-' + str(number) + '-' + ref, ResultCompletion.COMPLETE, True, fields) for ref in refs)
print(json.dumps({'status': 'PROJECTION', 'source_revision': revision.oid, 'spec_blob_oid': oid, 'tasks': len(plan.tasks), 'test_intents': len(plan.test_intents), 'rounds': rounds, 'held': ['spec.hq-expansion#task.request-composition.001', 'spec.hq-expansion#task.wiki-integration.001'], 'authority_effect': 'none', 'projection_only': True, 'catalog_adoption': False, 'projection_catalog_sha256': hashlib.sha256(catalog).hexdigest(), 'actual_builder_tuple': 'claude-sonnet-5-5/high via native catalog', 'typed_model_limit': 'Opus placeholder only in nonlaunching fixtures; no native model attestation.', 'scope': 'Actual authored graph with hypothetical accepted predecessor results. No implementation task is claimed complete.'}, indent=2))
