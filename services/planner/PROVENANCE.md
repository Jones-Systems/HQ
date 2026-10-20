# Planner source provenance

This service was extracted from the private MIT-licensed
`Jones-Systems/Codex-V3` repository by M Jones’s selected app-source extraction
directive of 2026-10-20. That decision covers the listed Planner files and
licensing notice, not unrelated repository history or private operational records.
It does not claim the source repository was previously public.

- Source revision: `abfa34ce793a738b436ff857dfe695a2e13ef2c3`, available through
  the source candidate ref `refs/pull/705/head`.
- The complete `apps/manual-planner` source tree has identical bytes at
  `1fd72c79fbfb53ed6b30edab8bc9197dbecd3a78`.
- Verbatim HQ import commit: `2148cbe57b579cc92675e5f161c887f83798f761`.
- All 41 selected files matched their source bytes, Git blobs, SHA-256 hashes
  and byte lengths before README adaptation.

[import-manifest.json](import-manifest.json), schema `hq.planner-import/v1`,
records that **import baseline**, not hashes of later service revisions.
Each entry names its source and destination path, source Git blob, SHA-256,
byte length and whether this extraction subsequently adapted it. Only README
was adapted: HQ identity and launch paths, external data ownership, public
provenance links, and the separate deployment boundary. LICENSE, this document,
the manifest and the service index are additions, not imported app files.

## Selected files

| Source path | HQ destination | Extraction treatment |
| --- | --- | --- |
| `apps/manual-planner/.gitignore` | `services/planner/.gitignore` | Verbatim |
| `apps/manual-planner/README.md` | `services/planner/README.md` | README adaptation |
| `apps/manual-planner/planning/__init__.py` | `services/planner/planning/__init__.py` | Verbatim |
| `apps/manual-planner/planning/__main__.py` | `services/planner/planning/__main__.py` | Verbatim |
| `apps/manual-planner/planning/dates.py` | `services/planner/planning/dates.py` | Verbatim |
| `apps/manual-planner/planning/examples.py` | `services/planner/planning/examples.py` | Verbatim |
| `apps/manual-planner/planning/server.py` | `services/planner/planning/server.py` | Verbatim |
| `apps/manual-planner/planning/store.py` | `services/planner/planning/store.py` | Verbatim |
| `apps/manual-planner/planning/validation.py` | `services/planner/planning/validation.py` | Verbatim |
| `apps/manual-planner/public/css/app.css` | `services/planner/public/css/app.css` | Verbatim |
| `apps/manual-planner/public/icon.svg` | `services/planner/public/icon.svg` | Verbatim |
| `apps/manual-planner/public/index.html` | `services/planner/public/index.html` | Verbatim |
| `apps/manual-planner/public/js/actions.js` | `services/planner/public/js/actions.js` | Verbatim |
| `apps/manual-planner/public/js/api.js` | `services/planner/public/js/api.js` | Verbatim |
| `apps/manual-planner/public/js/app.js` | `services/planner/public/js/app.js` | Verbatim |
| `apps/manual-planner/public/js/date-editor.js` | `services/planner/public/js/date-editor.js` | Verbatim |
| `apps/manual-planner/public/js/dates.js` | `services/planner/public/js/dates.js` | Verbatim |
| `apps/manual-planner/public/js/detail.js` | `services/planner/public/js/detail.js` | Verbatim |
| `apps/manual-planner/public/js/dom.js` | `services/planner/public/js/dom.js` | Verbatim |
| `apps/manual-planner/public/js/drag.js` | `services/planner/public/js/drag.js` | Verbatim |
| `apps/manual-planner/public/js/model.js` | `services/planner/public/js/model.js` | Verbatim |
| `apps/manual-planner/public/js/ordering.js` | `services/planner/public/js/ordering.js` | Verbatim |
| `apps/manual-planner/public/js/state.js` | `services/planner/public/js/state.js` | Verbatim |
| `apps/manual-planner/public/js/ui.js` | `services/planner/public/js/ui.js` | Verbatim |
| `apps/manual-planner/public/js/views/archive.js` | `services/planner/public/js/views/archive.js` | Verbatim |
| `apps/manual-planner/public/js/views/board.js` | `services/planner/public/js/views/board.js` | Verbatim |
| `apps/manual-planner/public/js/views/calendar.js` | `services/planner/public/js/views/calendar.js` | Verbatim |
| `apps/manual-planner/public/js/views/common.js` | `services/planner/public/js/views/common.js` | Verbatim |
| `apps/manual-planner/public/js/views/glance.js` | `services/planner/public/js/views/glance.js` | Verbatim |
| `apps/manual-planner/public/js/views/list.js` | `services/planner/public/js/views/list.js` | Verbatim |
| `apps/manual-planner/public/js/views/review.js` | `services/planner/public/js/views/review.js` | Verbatim |
| `apps/manual-planner/public/js/views/timeline.js` | `services/planner/public/js/views/timeline.js` | Verbatim |
| `apps/manual-planner/public/manifest.webmanifest` | `services/planner/public/manifest.webmanifest` | Verbatim |
| `apps/manual-planner/tests/app_smoke.test.mjs` | `services/planner/tests/app_smoke.test.mjs` | Verbatim |
| `apps/manual-planner/tests/client_logic.test.mjs` | `services/planner/tests/client_logic.test.mjs` | Verbatim |
| `apps/manual-planner/tests/display_zone.test.mjs` | `services/planner/tests/display_zone.test.mjs` | Verbatim |
| `apps/manual-planner/tests/fake_dom.mjs` | `services/planner/tests/fake_dom.mjs` | Verbatim |
| `apps/manual-planner/tests/render_smoke.test.mjs` | `services/planner/tests/render_smoke.test.mjs` | Verbatim |
| `apps/manual-planner/tests/support.py` | `services/planner/tests/support.py` | Verbatim |
| `apps/manual-planner/tests/test_server.py` | `services/planner/tests/test_server.py` | Verbatim |
| `apps/manual-planner/tests/test_store.py` | `services/planner/tests/test_store.py` | Verbatim |

Excluded: `apps/manual-planner/provenance.json`, whose historical private
coordination and QA inventory is outside this selected extraction. This public
provenance replaces it without copying its contents. No session records,
private operational documentation, host addresses or provider-account metadata
are part of the import.

## Work upstream equality

At Work source revision `562986d1852d7b4ef101ff6d4c9340c3751c727a`, the
existing copies under `modules/work/core/upstream/manual-planner/` match the
imported `public/js/` files byte for byte:

| File | SHA-256 |
| --- | --- |
| `ordering.js` | `abf141543f18fcbaefe8abae92a3f35c295d4a093ab73c8eabe30da7d57d868b` |
| `dates.js` | `390c39e8fda9c539a388cfac4675eca97356893e27dd36ae4f589767c954b903` |
| `model.js` | `fb24638a1a68b85c5f2185668c1335ec0403ee219cba75075f22fb1896041f80` |

Those pinned copies and their provenance remain Work-owned. Repointing Work’s
upstream provenance to this service is a proposal for its owner, not an effect
of this extraction. Source extraction changes no deployed process or data.

## License

The following notice is copied verbatim from the source repository’s root
`LICENSE` at the selected revision and is also preserved in [LICENSE](LICENSE).
It covers this import; no repository-wide HQ license is established here.

```text
MIT License

Copyright (c) 2026 Malcolm Jones

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
