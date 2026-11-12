# SOC-X shared integration request

Authority effect: none. Source proposal only; do not activate publishing. Reconcile against the current shared writers before applying. No shared source file is edited by SOC-X.

## Shared contract hunk

INT: in `packages/contracts/src/services.ts`, append the nine route identifiers and parameter interfaces exactly as in `modules/social/live/transport.ts`: `setBrandProject`, `source`, `saveSource`, `archiveSource`, `publishingConnect`, `publishingDisconnect`, `publishingRequest`, `publishingCancel`, `publishingApprove`. Extend `submitRun` with optional `source_ids: readonly string[]`. Mirror `SaveSource` structurally in shared contracts; do not import a module-owned runtime into contracts. Preserve all existing route identifiers and envelopes.

The service/client workspace adds `Brand.project_id`, `sources`, optional simulator `publishing`, and `RunRecord.source_ids`. Extension methods are exposed by `ExtendedSocialWorkspacePort` so existing legacy port implementations remain valid. The renderer must have observed the corresponding feature in its latest snapshot before any extension transport call. An absent feature rejects locally as `invalid`, with no pre-read/mutation.

## Encoder and refresh hunks (INT coordinates the WSP-owned file)

In `apps/desktop/electron/services.ts`, extend `SOCIAL_PATHS` and `encodeSocial` with the following closed mapping. Extract `id` into the path and remove it from the HTTP body. Validate IDs with the existing opaque-ID predicate (or the built-in brand `default` for the brand route); do not accept slashes, percent escapes or arbitrary URLs. Keep JSON-only validation and the existing 2,000,000-byte request/response limits. Workspace alone retains its existing larger cap.

| Operation | Required params; optional params | HTTP | Class / loss |
| --- | --- | --- | --- |
| `setBrandProject` | `id, project_id` | POST `/api/brands/<id>/project`, body `{project_id}` | content / unknown |
| `source` | `id` | GET `/api/sources/<id>`, no body | read / unavailable |
| `saveSource` | `name, kind, file_name, text, as_of` | POST `/api/sources`, same body | content / unknown |
| `archiveSource` | `id, archived` | POST `/api/sources/<id>/archive`, body `{archived}` | content / unknown |
| `publishingConnect` | `channel, label` | POST `/api/publishing/connections`, same body | content / unknown |
| `publishingDisconnect` | `id` | POST `/api/publishing/connections/<id>/disconnect`, body `{}` | content / unknown |
| `publishingRequest` | `draft_id, draft_version, connection_id` | POST `/api/publishing/requests`, same body | content / unknown |
| `publishingCancel` | `id` | POST `/api/publishing/requests/<id>/cancel`, body `{}` | content / unknown |
| `publishingApprove` | `id, content_sha256` | POST `/api/publishing/requests/<id>/approve`, body `{content_sha256}` | execution / unknown |
| `submitRun` | existing required params; optional `source_ids` | existing POST `/api/runs`, add `source_ids` verbatim when present | execution / unknown |

Exact validation additions: project ID is null or 1–160 UTF-16 units, trimmed and without C0/C1 controls; source kind is the closed `SOURCE_KINDS` list; source name/file name/text/as_of are strings (bounded by service spec); archive is integer 0 or 1; publishing channel excludes General/Article; label is 1–80 units; draft version is a positive safe integer; approval hash is exactly 64 lowercase hex characters; source IDs are a list of at most 20 valid IDs. Reject extra keys before sending. No file picker, filesystem path, endpoint, account or credential enters this seam.

Extend the existing exact-token-error refresh predicate at `createServices().social.call`: allow the existing one workspace refresh only for `saveContent`, `addBrand`, `setBrandProject`, `saveSource`, `archiveSource`, `publishingConnect`, `publishingDisconnect`, `publishingRequest`, `publishingCancel`. Never refresh/replay `submitRun` or `publishingApprove`, even on token rejection. Preserve all transport unknown rules.

## Main/activation boundary

No new Electron main construction, channel, startup, setting or service-launch hunk is requested. Existing generic Social channel dispatch should consume the expanded shared route set through its current validation. Keep service startup publishing off and desktop real-provider enablement absent. Do not pass `--publishing simulator` from normal startup. Service support is not activation authority.

## Required integration evidence (unrun here)

Add encoder tests for each exact path/body and unknown-key/path rejection; classify read loss as unavailable and every mutation loss as unknown. Test a content route's one token refresh, approval/submission's zero refresh, and feature-absent zero calls. Run the real-service conformance path after applying these hunks; fixture-wire conformance alone does not exercise shared preload/main encoding.
