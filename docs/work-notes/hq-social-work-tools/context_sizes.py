"""Report each task's resolved context bytes against the compiler's default 32 KiB bound.

Usage: python3 context_sizes.py <HQ checkout>
"""
import json, re, sys
from pathlib import Path

repo = Path(sys.argv[1])
docs = {"spec.hq-social-work": repo / "docs/engineering-specs/hq-social-work.md",
        "brief.hq-shared-foundation": repo / "docs/design/hq-shared-foundation.md"}
sections = {}
for path in docs.values():
    for m in re.finditer(r'<!-- codex-section:begin id="([^"]+)" -->\n(.*?)(?=<!-- codex-section:end id="\1" -->)', path.read_text(), re.S):
        sections[m.group(1)] = len(m.group(2).encode())
spec = docs["spec.hq-social-work"].read_text()
block = lambda ref: json.loads(re.search(rf'<!-- codex-section:begin id="{re.escape(ref)}" -->\n```json\n(.*?)```', spec, re.S).group(1))
plan = block("spec.hq-social-work#plan.implementation.001")
for ref in sorted(k for k in sections if "#task." in k):
    t = block(ref)
    refs = dict.fromkeys([*plan["default_context_refs"], *t["context_refs"], *t["requires"], *t["acceptance_refs"], *t["test_refs"]])
    total = sum(sections[r] for r in refs)
    print(f'{total:6d} {"OVER" if total > 32 * 1024 else "ok  "} {ref.split("#task.")[1]}')
