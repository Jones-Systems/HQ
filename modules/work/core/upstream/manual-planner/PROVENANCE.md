# Manual Planner upstream copies

These three files are **verbatim, byte-for-byte copies** from the Manual Planner. M Jones approved their import (owner decision D-1, 2026-10-20; `spec.hq-social-work#ctx.d1-import.001`). No other Manual Planner file is imported.

| Field | Value |
| --- | --- |
| Source repository | `Jones-Systems/Codex-V3` (private), MIT License |
| Source commit | `4beb491c44551b6e4207adcc7459c4b11407bcbc` |
| Last change to these files | `41503af8f1d143de54063ee70effb00ffdd399b1` (Malcolm Jones) |

| Copy | Source path | Git blob | SHA-256 | Bytes |
| --- | --- | --- | --- | --- |
| `ordering.js` | `apps/manual-planner/public/js/ordering.js` | `0415a2103a33f79679284e19c09fbf5a911ae5a5` | `abf141543f18fcbaefe8abae92a3f35c295d4a093ab73c8eabe30da7d57d868b` | 2,759 |
| `dates.js` | `apps/manual-planner/public/js/dates.js` | `8932be4def432eec59b60427741a08ee4fe66db7` | `390c39e8fda9c539a388cfac4675eca97356893e27dd36ae4f589767c954b903` | 12,752 |
| `model.js` | `apps/manual-planner/public/js/model.js` | `926a54e980b384901e50bcd7a20c488fca01ba2a` | `fb24638a1a68b85c5f2185668c1335ec0403ee219cba75075f22fb1896041f80` | 6,575 |

Each SHA-256 also matches the source's own `apps/manual-planner/provenance.json` at that commit.

## Rules

- **Do not edit these copies.** `modules/work/core/test/upstream-integrity.test.ts` recomputes each SHA-256 and Git blob ID and fails on any drift.
- Adaptations live in TypeScript wrappers under `modules/work/core/` (`planning.ts`, `validation.ts`, `store.ts`). The display zone and week start always come from the Planner settings.
- The sibling `.d.ts` files are hand-written HQ declarations, not upstream content. They let strict TypeScript consume the copies without `allowJs`.
- Updating a copy needs a new owner import decision, new bytes from an exact source commit, and an updated table here.

## License notice

The copied files are covered by the source repository's license:

```
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
