# After evidence: Wiki reference provider, W3 (2026-11-03)

Authority effect: none. Lane F6 builder W3 captures of the Wiki as an HQ reference provider (cross-app finding X9): a
Social draft's "Link to…" picker finds Wiki pages, and opening the saved link shows the Wiki reader with the shell's
Back-to-origin button. The provider is `modules/wiki/app/src/references.ts`; its registration is one entry in
`apps/desktop/src/reference-providers.ts`.

| Item | Value |
| --- | --- |
| Candidate | `work/hq-life-wiki-w3-20261103`, based on `work/hq-life-wiki-settings-20261103` at `d2711c7`. Captured at `5d468b8` (provider `3008ff2`, registration and desktop tests `08dc0ea`, README `5d468b8`) |
| Surface | Real desktop renderer (`apps/desktop/index.html` → `src/main.tsx`) served by Vite 8.3.4 on loopback, with synthetic `window.hqServices` bridges installed before the app (lane scratch harness, kept outside the repository) |
| Data | Wiki: `modules/wiki/ui/fixtures/synthetic.ts` only (invented pages). Social: the repository's synthetic wire stub with references enabled (invented brands and drafts). No real corpus, account, host or credential |
| Browser | Headless Chrome 156 over CDP, isolated temporary profile, 1280×820 CSS px, scale 1, light appearance |
| Fonts | Sans stack pinned to Liberation Sans, because this host maps `sans-serif` to a monospace face |
| Not covered | Electron and preload, macOS rendering, screen readers, dark appearance, the Work picker, the cross-HQ palette (lane F7), animation timing |

| File | Shows |
| --- | --- |
| `w3-01-draft-before-link.png` | A Social draft, "Linked across HQ" empty. "Link to…" is the entry point |
| `w3-02-link-picker-wiki-results.png` | The picker after typing "pricing": five Wiki pages, each with its logical identity (`wiki · page · <namespace>/<path>`). The two same-titled pages are told apart by their namespace and path |
| `w3-03-draft-with-wiki-link.png` | The chosen page saved as a link: title, "Available", provenance line, and Open, Unlink and Update snapshot. "Snapshot revision unknown" is expected: search hits carry no commit, so a link made from the picker has no `sourceRevision` |
| `w3-04-wiki-reader-from-reference.png` | After Open: the Wiki reader on the linked page (App Development, `research/pricing.md`), with the shell's "Back to Autumn blend tasting notes" button above it |
| `w3-05-back-at-draft.png` | After Back: the draft is restored with its link still in place |

Reproduce: serve the renderer from this worktree with the harness's Wiki and Social fakes, open the draft
(`hq.navigation.v1:hq-local` set to the Social library draft), then drive the steps above. The harness lives outside the
repository; the repeatable proof is `apps/desktop/src/wiki-references.integration.test.tsx`, which runs the same path
over the real Wiki host and a synthetic corpus.
