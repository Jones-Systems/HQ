"""Parse the committed spec with the real Codex V3 helper.

Usage: PYTHONPATH=<Codex V3 checkout>/src python3 validate.py <HQ checkout> <commit>
"""
import hashlib, sys, subprocess
from pathlib import Path
from codex_v3.orchestration import RevisionIdentity
from codex_v3.specification_plan import AffectedCheckCatalogBinding, CHECK_CATALOG_SCHEMA, parse_engineering_spec_plan
repo = Path(sys.argv[1]); rev = sys.argv[2]
def catalog_bytes(spec_text):
    """Projection catalog: the TOML fence in ctx.check-catalog.001 (a proposed delta, not tests/check-groups.toml)."""
    sec = spec_text.split('<!-- codex-section:begin id="spec.hq-social-work#ctx.check-catalog.001" -->', 1)[1].split('<!-- codex-section:end', 1)[0]
    return sec.split('```toml\n', 1)[1].split('```', 1)[0].encode()
spec_src = spec_src
manifest = catalog_bytes(spec_src.decode())
groups = tuple(sorted(l.split('.',1)[1].rstrip(']\n') for l in manifest.decode().splitlines() if l.startswith('[groups.')))
revision = RevisionIdentity(rev)
cat = AffectedCheckCatalogBinding(CHECK_CATALOG_SCHEMA, revision, 'tests/check-groups.toml', hashlib.sha256(manifest).hexdigest(), groups,
     f'proposed:spec.hq-social-work#ctx.check-catalog.001@{rev}')
src = spec_src
plan = parse_engineering_spec_plan(src, cat, source_revision=revision)
print('parsed', plan.artifact_id, len(plan.tasks), 'tasks', len(plan.test_intents), 'intents; manifest sha256', cat.manifest_sha256, 'groups', groups)
