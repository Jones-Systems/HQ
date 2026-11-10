"""Build synthetic, language-neutral reference cases; no service imports."""
from copy import deepcopy
import json
from pathlib import Path

TARGET = {"version": 1, "domain": "design", "projectId": "project-example", "kind": "artifact",
          "entityId": "artifact-example", "title": "Example design",
          "returnDestination": {"domain": "design", "destination": "artifact/example"}}
REFERENCE = {"id": "ref001", "kind": "hq", "label": "Example design", "target": TARGET}


def vectors():
    cases = []

    def accept(name, refs, expected=None):
        cases.append({"id": name, "input": deepcopy(refs), "expected": deepcopy(refs if expected is None else expected)})

    def reject(name, refs, message="Reference 1 has an invalid HQ target."):
        cases.append({"id": name, "input": deepcopy(refs), "errors": [{"field": "references", "message": message}]})

    accept("minimal-hq", [deepcopy(REFERENCE)])
    for domain in ("social", "work"):
        ref = deepcopy(REFERENCE)
        ref["target"]["domain"] = domain
        ref["target"]["returnDestination"]["domain"] = domain
        accept(f"domain-{domain}", [ref])
    ref = deepcopy(REFERENCE)
    ref["target"].update(sourceRevision="revision-1", workspaceId="workspace-example")
    accept("optional-provenance", [ref])
    ref = deepcopy(REFERENCE)
    del ref["label"]
    accept("label-default", [ref], [deepcopy(REFERENCE)])
    ref = deepcopy(REFERENCE)
    ref["label"] = "  Example\t design  "
    accept("label-normalized", [ref], [deepcopy(REFERENCE)])
    accept("legacy-url", [{"id": "url001", "kind": "url", "url": "https://example.com/"}],
           [{"id": "url001", "kind": "url", "label": "https://example.com/", "url": "https://example.com/"}])
    for name, patch in [
        ("bool-version", {"version": True}), ("wrong-version", {"version": 2}),
        ("unknown-domain", {"domain": "unknown"}), ("extra-key", {"extra": "x"}),
        ("null-optional", {"sourceRevision": None}), ("empty-optional", {"workspaceId": ""}),
        ("trim-space", {"entityId": " x"}), ("trim-bom", {"entityId": "\ufeffx"}),
        ("control", {"title": "a\x7fb"}), ("utf16-overflow", {"entityId": "😀" * 81}),
        ("title-overflow", {"title": "x" * 301}),
        ("source-revision-overflow", {"sourceRevision": "x" * 301}),
        ("workspace-overflow", {"workspaceId": "x" * 161}),
    ]:
        ref = deepcopy(REFERENCE)
        ref["target"].update(patch)
        reject(name, [ref])
    for field in TARGET:
        ref = deepcopy(REFERENCE)
        del ref["target"][field]
        reject(f"missing-{field}", [ref])
    for name, route in [("scheme", "https:example"), ("scheme-case", "JaVaScRiPt:x"),
                        ("scheme-unicode-fold", "Kcheme:x"), ("scheme-long-s-fold", "ſcheme:x"),
                        ("slashes", "//example"), ("backslashes", "\\\\example"),
                        ("mixed-slashes", "/\\example"), ("mixed-backslashes", "\\/example"),
                        ("route-overflow", "x" * 513)]:
        ref = deepcopy(REFERENCE)
        ref["target"]["returnDestination"]["destination"] = route
        reject(name, [ref])
    for name, patch in [("destination-extra", {"extra": True}), ("destination-domain", {"domain": "unknown"})]:
        ref = deepcopy(REFERENCE)
        ref["target"]["returnDestination"].update(patch)
        reject(name, [ref])
    for name, patch in [("utf16-boundary", {"entityId": "😀" * 80}),
                        ("non-js-whitespace", {"entityId": "\x85identity\x85"}),
                        ("title-boundary", {"title": "x" * 300}),
                        ("optional-boundaries", {"sourceRevision": "x" * 300, "workspaceId": "x" * 160})]:
        ref = deepcopy(REFERENCE)
        ref["target"].update(patch)
        accept(name, [ref])
    ref = deepcopy(REFERENCE)
    ref["target"]["returnDestination"]["destination"] = "x" * 512
    accept("destination-boundary", [ref])
    ref = deepcopy(REFERENCE)
    ref["label"] = "😀" * 200
    accept("label-code-points", [ref])
    ref = deepcopy(REFERENCE)
    ref["label"] = "x" * 201
    reject("label-overflow", [ref], "Limited to 200 characters.")
    ref = deepcopy(REFERENCE)
    ref["target"]["title"] = "x" * 201
    del ref["label"]
    reject("default-label-overflow", [ref], "Limited to 200 characters.")
    for key in ("url", "extra"):
        ref = deepcopy(REFERENCE)
        ref[key] = ""
        reject(f"hq-forbids-{key}", [ref], "Reference 1 is malformed.")
    ref = deepcopy(REFERENCE)
    ref["id"] = "ref002"
    ref["target"]["projectId"] = "other-project"
    reject("duplicate-across-projects", [deepcopy(REFERENCE), ref], "Reference 2 duplicates another HQ link.")
    a, b = deepcopy(REFERENCE), deepcopy(REFERENCE)
    a["target"].update(kind="a/b", entityId="c")
    b["target"].update(kind="a", entityId="b/c")
    b["id"] = "ref002"
    reject("slash-identity-collision", [a, b], "Reference 2 duplicates another HQ link.")
    ref = deepcopy(REFERENCE)
    ref["target"]["entityId"] = "distinct"
    reject("duplicate-entry-id", [deepcopy(REFERENCE), ref], "Reference 2 is malformed.")
    ref["id"] = "ref002"
    accept("distinct-targets", [deepcopy(REFERENCE), ref])
    return {"schema": "hq.planner.reference-vectors/v1", "feature": "hq-references-v1",
            "generated_entry_id": "generated001", "cases": cases}


def rendered():
    return json.dumps(vectors(), indent=2, ensure_ascii=True) + "\n"


if __name__ == "__main__":
    Path(__file__).with_name("reference-vectors.json").write_bytes(rendered().encode())
