# Reference producer input formats (public note)

Plan: `spec.hq-expansion#ctx.reference-producer.001`, task `spec.hq-expansion#task.reference-producer.001`.

**No private files were selected, opened or copied to write this note.** It lists version
discriminators and field names only, with hand-authored fake examples. It contains no real
values, names, IDs or paths. The formats below are the clean-room *input contract* the adapters
accept. How an owner's real local corpus is exported into this contract is a separate, local step,
and conformance of any real corpus is unqualified until the owner supplies an authorized input.

Everything is JSON (UTF-8) plus image or video files. The adapters read only files that a
manifest names; they never walk directories, follow links, or read HTML, JS, CSS or SVG.

## Shared rules

- Every JSON file starts with `"schema": "<discriminator>"`. An unknown discriminator or a
  version newer than the adapter knows aborts the whole run with no output.
- Digests are `sha256:` followed by 64 lowercase hex characters.
- Relative file references are `/`-separated, never absolute, never contain `.` or `..`
  segments, and never pass through a symbolic link.
- Fields the adapter does not know are ignored and counted, never copied. Fields named
  `rating`, `ratings`, `note`, `notes` and `taste` are dropped and counted. Mutable acquisition
  trees, captured markup and scripts are not part of any format.
- Declared sizes and digests are checked against the bytes read.

## 1. External local configuration

`"schema": "hq.design.reference-producer-config/v1"`. Lives outside the repository; its values
are never published.

| Field | Meaning |
| --- | --- |
| `outputRoot` | Owned output store directory (absolute). Must have no Git ancestor. |
| `sources[]` | Source descriptors. |
| `sources[].id` | Lower-case token naming the source in output. |
| `sources[].kind` | `gallery` or `study`. |
| `sources[].root` | Absolute directory of the source. |
| `sources[].pointer` | Gallery only: name of the current pointer (a symbolic link). |
| `sources[].releases` | Gallery only: the allowed release names the pointer may name. |
| `sources[].producer` | Optional `{ id, label }` recorded as producer provenance. |
| `sources[].rights` | Optional `{ vocabulary, value, basis, attribution }` default rights. |
| `sources[].limits` | Optional `{ maxFileBytes, maxJsonBytes, maxTotalBytes, maxFiles }`. |

```json
{
  "schema": "hq.design.reference-producer-config/v1",
  "outputRoot": "<absolute path>",
  "sources": [
    { "id": "example-gallery", "kind": "gallery", "root": "<absolute path>", "pointer": "current", "releases": ["A", "B"],
      "rights": { "vocabulary": "hq.design.references/v1", "value": "unknown" } }
  ]
}
```

## 2. Gallery releases (kind `gallery`)

Two immutable releases sit beside a pointer: `<root>/A/`, `<root>/B/`, `<root>/<pointer>`.
The pointer is a symbolic link whose target is exactly one allowed release name. It is resolved
once, and that is the only link the adapter follows. Release directories and everything inside
them must be regular, link-free files.

`release.json`, `"schema": "hq.producer.gallery-release/v1"`:
`release`, `generation`, `catalog` (relative file name), `catalogDigest`.

`catalog.json`, `"schema": "hq.producer.gallery-catalog/v1"`: `entries[]`, each one of

- `{ "kind": "website", "origin", "title", "pages": [ { "url", "title", "captures": [ Capture ] } ] }`
- `{ "kind": "app", "platform", "appId", "title", "screens": [ { "key", "title", "captures" } ], "flows": [ { "key", "title", "steps" } ] }`

`Capture`: `kind`, `capturedAt`, `capturedBy`, optional `captureKey` (when there is no image),
`image`, `sourceStatus`, `rights`, `producer`, `nativeEvidence`, `anchors[]`.

`image`: `path`, `sha256`, `bytes`, `mediaType`, optional `w`, `h`, `durationMs`.

`anchors[]` item: `key`, `kind` (`section` or `element`), `label`, optional `parentKey`, `rect`
(`x`, `y`, `w`, `h`, fractions of the image).

```json
{
  "schema": "hq.producer.gallery-catalog/v1",
  "entries": [
    { "kind": "website", "origin": "https://example.test", "title": "Example", "pages": [
      { "url": "https://example.test/", "title": "Home", "captures": [
        { "kind": "screenshot", "capturedAt": "2026-01-01T00:00:00.000Z", "capturedBy": "agent-reported",
          "image": { "path": "images/home.png", "sha256": "sha256:<64 hex>", "bytes": 123, "mediaType": "image/png" },
          "anchors": [ { "key": "hero", "kind": "section", "label": "Hero", "rect": { "x": 0, "y": 0, "w": 1, "h": 0.4 } } ] }
      ] }
    ] }
  ]
}
```

## 3. Studies (kind `study`)

`study.json`, `"schema": "hq.producer.study/v1"`: `title`, `subject`
(`{ "kind": "website", "origin" }` or `{ "kind": "app", "platform", "appId", "name" }`),
`runs[]` (`id`, `path`).

`receipt.json`, `"schema": "hq.producer.study-receipt/v1"`: `studyDigest` (digest of the exact
bytes of `study.json`), `status` (`complete` or `partial`), `files[]` (`path`, `digest`: every
run and annotation file), `completeRuns[]` (run IDs).

Run file, `"schema": "hq.producer.study-run/v1"`: `runId`, `title`, `steps[]`, optional
`annotations` (relative path). A step is `key`, `title`, optional `url` (website studies) and
`frames[]`; a frame is `kind`, `capturedAt`, optional `captureKey`, `image`, `sourceStatus`,
`rights`, `nativeEvidence`, `facts[]` (same fields as `anchors[]`).

Annotation file, `"schema": "hq.producer.study-annotations/v1"`: `runId`, `frames[]`
(`step`, `index`, `facts[]`).

```json
{ "schema": "hq.producer.study-receipt/v1", "studyDigest": "sha256:<64 hex>", "status": "partial",
  "files": [ { "path": "runs/run-1.json", "digest": "sha256:<64 hex>" } ], "completeRuns": [] }
```

## Output (not an input format)

An owned external store holds, per source, `hq.design.reference-packet/v1` files (an `internal`
and a `publishable` packet), content-addressed blobs and an aggregate receipt. Nothing from
these formats' free-text fields is echoed into logs or evidence.

## Rights

`rights` carries a declared `vocabulary` and `value`, mapped by the reference graph's explicit
registry. The producer only ever tightens: the source default and a capture's own statement are
combined by taking the more restrictive. Private, non-redistributable (`restricted`) and unknown
never become permitted. A claimed `permitted` with no basis is treated as unknown.
