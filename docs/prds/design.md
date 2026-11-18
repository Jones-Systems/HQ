# HQ Design

<!-- codex-section:begin id="prd.hq-design#ctx.artifact-header.001" -->
Artifact Type: `prd`
Artifact ID: `prd.hq-design`
Purpose: A desktop hub for making, comparing, recording and executing UI decisions.
Governing artifact: `none`
Decision owner: M Jones
Consumers: Design implementation lanes and HQ integration owners
Authority effect: none
<!-- codex-section:end id="prd.hq-design#ctx.artifact-header.001" -->

## Product

HQ is an Electron desktop application. Design is its UI decision workspace for websites, apps, components and interactive prototypes. A user can organize projects and their views, put several versions on a canvas, compare them, select elements or cite text, record decisions and send a frozen request to a qualified Jones Code destination. Returned work stays linked to its request and source version. Multiple providers and execution hosts are part of the product direction; they depend on qualified Jones APIs rather than an embedded provider runtime.

The shared shell places Design before Social and Work, supports Light/Dark/System and preserves each domain's navigation and unfinished work. Social and Work have separate owners. Design's spatial canvas is distinct from Work's planning board. A card gesture, theme change, domain switch or reference navigation never starts execution.

## Requirements

- Projects contain multiple views, revisions and artifacts. Canvas is the normal working surface. Gallery and compact project-filtered lists support discovery, switching and lazy previews. Keep captures bound to their route, viewport, source revision and provenance.
- Canvas supports multiple views/versions, panning, zoom, arrangement, selection and persistent layout. Compare versions side by side and at matched viewports, including a clear baseline/candidate identity. Do not overwrite historical captures when editing notes.
- Element picking and selected-text citation are separate actions. Annotations bind to a source revision and explicit coordinate frame; scrolling, scaling and routes must not silently move their meaning. Stable reference letters survive deletion. Revisit is toggleable. Support Back to Gallery, compact name/details, drafts and Copy/export.
- References include websites/apps, motion and UI resources. Components, design systems, flows, UI maps, runnable code/prototypes, native evidence and designer/builder guidance remain part of the full scope. A browser mock is not native acceptance evidence.
- Taste/evaluation separates general from project preferences, descriptive observations from liking, overall and aspect ratings from 1–5, notes and counterevidence. Preserve rerating history, provenance and limited sample confidence. Never train or change model defaults merely because a rating is saved.
- Preserve editable drafts independently from frozen requests. Export/import must explicitly cover canvas, references, comments, text proposals and selected attachments; omitted stores are reported. No silent down-conversion or destructive repair.
- Requests carry immutable source IDs/revisions, selected evidence, decisions, destination and a content digest. Wire-protocol digest is distinct from the authoring digest. Explicit send is the execution boundary. Existing-thread handoff is the first qualified loop; creating threads or selecting remote hosts/models requires the corresponding external capability.
- Receipts distinguish accepted, held, rejected and unknown. Accepted means the external command was durably accepted; it does not mean implementation is complete or approved. Reconciliation never sends. Unknown effects require authoritative readback before retry; search absence proves nothing.
- Returned candidates link back to exact requests/source versions, support comparison and explicit user acceptance, and preserve observed execution status/freshness. Finished products do not depend on HQ's review layer.
- Dark/light chrome is accessible and keyboard usable. Captured bytes and producer previews retain their intended colors independently of HQ appearance.

## Delivery and acceptance

Deliver a useful local vertical slice before claiming full parity: create/switch project and view; arrange and compare two versions; add a revision-bound annotation and text citation; save/reopen; freeze/export a request; exercise a qualified existing-thread handoff or visibly report it unavailable; attach and compare a returned candidate. Independent modules can land before this cumulative integration passes, but are not individually the finished product.

HQ is piloted from the laptop. Show projects across enrolled devices through a locally cached catalog and background refresh; fetch previews and needed content on demand and retain local working copies for responsiveness. The laptop owns editable Design state initially; two-way synchronization is not required. Warm project navigation must not wait for network. Preserve source identity, provenance, freshness and stale/offline states. Explicit export/import remains useful for backups. No private owner dataset ships in the public repository. Use synthetic fixtures. No remote-service migration, credential enrollment, signing, notarization, release or installation follows from source implementation authority.

## Technical slices

One foundation owns the Electron host/root dependencies/contracts. Independent Design lanes own project/gallery, canvas, comparison, annotations, requests, taste, references, components/prototypes, flows/maps, import/persistence and connector/returned-result sections. A Design integration owner mounts the module and proves the full loop. The execution spec fixes exact scopes, interfaces and readiness before runnable assignments; no duplicate whole-app scaffold.
