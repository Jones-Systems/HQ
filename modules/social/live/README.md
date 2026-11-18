# Social live adapter: contract for view authors

This is the stable surface between Social views and a Social service. It describes what the code does today and marks planned items as *planned*. The normative statements live in the engineering spec: [`iface.adapter.001`](../../../docs/engineering-specs/backend-assessment-social-20261103.md#stable-adapter-contract) (what views may rely on; changes are additive only) and [`iface.extensions.001`](../../../docs/engineering-specs/backend-assessment-social-20261103.md#extension-contracts-target-ws-x) (the planned feature-gated extensions). This page does not repeat them. The recorded behavior of the adapter is in the [social-runtime evidence](../../../docs/evidence/hq-social-work/social-runtime/README.md).

Views never see an endpoint, header, token or HTTP. They receive a `SocialWorkspacePort` and call methods on it.

## Where the workspace comes from

`apps/desktop/src/services/domains.tsx` chooses the source **once per renderer** and caches the choice across remounts and domain switches:

| Social configuration | Source | What the views get |
| --- | --- | --- |
| A valid HTTPS or loopback-HTTP address is saved | **live** | `createLiveSocialPort(window.hqServices.social)` |
| Nothing is saved (an explicit, valid "not configured" answer) | **example** | A fictional in-window workspace. Nothing is sent anywhere and runs stay queued. `SocialDomain` gets `example`, which shows the banner. |
| Anything else: a rejected address, an unreadable status, no bridge | **unavailable** | No port. HQ shows the status line only. It never falls back to the example workspace. |

An address change applies after HQ reloads. Fixture and live sessions never mix, so a view must not assume it can switch source at runtime.

## The port

`SocialWorkspacePort` is defined in [`core/port.ts`](../core/port.ts). `CALL_CLASSES` is exhaustive by type, so a new method cannot be added without a class.

| Method | Class | Service call | Notes |
| --- | --- | --- | --- |
| `snapshot()` | content | `GET /api/workspace` | Brands, drafts, the latest 200 runs without output, tools and `features`. |
| `saveDraft(draft)` | content | `POST /api/content` | Versioned. A stale version is `conflict`, never a silent overwrite. |
| `addBrand(name)` | content | `POST /api/brands` | |
| `example(tool)` | read | `GET /api/sample/<tool>` | |
| `run(id)` | read | `GET /api/runs/<id>` | Includes `output` once the run has finished. |
| `submitRun(tool, input, isExample)` | **execution** | `POST /api/runs` | The only execution-class call. Call it only from an explicit **Run** action. |

The adapter validates with the same rules as the fixture before it sends, so an invalid call makes **zero** transport calls. A page that only opens, navigates or switches domains makes zero execution calls.

Two vocabularies are in play. The port's **call classes** (`content`, `read`, `execution`) are for recording and gating, for example the tests that assert zero `execution` calls. **Error mapping** uses the bridge route instead: `workspace`, `sample` and `run` are *read routes*, and `saveContent`, `addBrand` and `submitRun` are *mutation routes*. So `snapshot()` is content-class but fails like a read.

## Feature gating

`snapshot().features` is the only capability channel. A feature that is absent keeps its UI disabled. Use `hasFeature(snapshot, name)`.

| Feature | Gates | State |
| --- | --- | --- |
| `hq-editorial-timebox-v1` | `Draft.planning_slot` (timed planning) | Client delivered; Fieldnotes serves it |
| `hq-references-v1` | `Draft.links` (draft links). The adapter sends `links` only when the last snapshot advertised this. | Client delivered. The desktop transport accepts links through PR #166, which this branch carries. Fieldnotes support is in an open pull request. |
| `hq-brand-project-v1` | `Brand.project_id` is shown, and the project-mismatch banner can compare it. There is **no write path yet**. | Display only |
| `hq-sources-v1` | Supplied-data source registry | *Planned* (WS-X); `iface.extensions.001` |
| `hq-publishing-simulator-v1` | Account connection and publishing as a local simulator, default off | *Planned* (WS-X); `iface.extensions.001` |

A planned feature adds port methods and bridge routes only alongside its flag. Per `iface.extensions.001`, without the flag those methods reject locally with `invalid` before any transport call.

## Errors: `PortError`

Every port method rejects with a `PortFailure`; read it with `portErrorOf(reason)`. The kinds are `invalid` and `conflict` (both carry the service `message`), `not_found`, `forbidden`, `unavailable`, and `unknown` (carries `attemptedAt`, a client stamp).

An *uncertain* outcome means a thrown or lost call, a malformed envelope or result, `ok:false kind:'unknown'`, a 5xx or any unmapped status, or a known status whose body is not exactly `{error: string}`. It is `unavailable` on a **read route** (`workspace`, `sample`, `run`) and `unknown` on a **mutation route** (`saveContent`, `addBrand`, `submitRun`).

| Outcome from the bridge | Read routes | Mutation routes |
| --- | --- | --- |
| `ok:false kind:'unavailable'`: the request was never sent | `unavailable` | `unavailable` |
| `ok:false kind:'unknown'`: sent, no answer | `unavailable` | `unknown` |
| HTTP 400 or 422 with `{error}` | `invalid` | `invalid` |
| HTTP 409 with `{error}` | `conflict` | `conflict` |
| HTTP 403 with `{error}` | `forbidden` | `forbidden` |
| HTTP 404 with `{error}` | `not_found` | `not_found` |
| A 2xx body that fails its guard | `unavailable` | `unknown` |
| Any other status, or a known status without `{error: string}` | `unavailable` | `unknown` |

A service 500 therefore reads as `unavailable` or `unknown`; its text is not shown (carried finding B2-F8).

## Execution is never retried

`submitRun` is sent **once**. Neither the adapter nor main resends it, and a stale-token 403 is not refreshed for it. A lost result is `unknown`, which means the service may or may not have started the run.

- Do not offer **Run again** after `unknown`. Show *Run status unknown*, then let the person **Check again**, which re-reads the run history and never resends.
- After a service restart the first `submitRun` can come back `forbidden` (its token is stale). That is by design: **Check again** reloads the workspace, which refreshes the token, and the person starts the run again deliberately.
- `submitRunOnce` in [`core/runs.ts`](../core/runs.ts) wraps the call, and `possibleRunMatches` lists runs that could be the outcome of an unknown submission. A match is never proved.

## Showing errors: `portErrorNotice`

`portErrorNotice(error, action)` in [`core/errors.ts`](../core/errors.ts) maps a `PortError` and the failed action (`'load' | 'save' | 'brand' | 'run' | 'read'`) to one presentation, so every page treats the same failure the same way.

```ts
const notice = portErrorNotice(portErrorOf(reason) ?? { kind: 'unavailable' }, 'save');
// { surface: 'inline' | 'toast' | 'banner', tone, title, message, recovery }
```

`recovery` is what the notice may offer: `fix-input`, `reload-latest`, `check-again` or `none`. None of them runs a tool. Service text for `invalid` and `conflict` is passed through unchanged.

| Kind | Surface | Tone | Recovery | Notes |
| --- | --- | --- | --- | --- |
| `invalid` | inline | danger | `fix-input` | Service message. |
| `conflict` on `save` | inline | warning | `reload-latest` | Title *Changed elsewhere*. |
| `conflict` on `run` | toast | warning | `none` | A full queue. Service message. |
| `not_found` | toast | warning | `check-again` | |
| `forbidden` | banner | danger | `check-again` | The service refused the request. *Check again* reconnects before retrying. |
| `unavailable` | banner | warning | `check-again` | Nothing changed. For `save`, the text is kept in this session. For `run`, runs are paused until the service is reachable. |
| `unknown` on `run` | toast | warning | `check-again` | *Run status unknown*, with "Don't start it again until the status is known." Never suggests running again. |
| `unknown` on `save` or `brand` | inline | warning | `check-again` | HQ could not confirm the result; check again before saving again. |

The helper also covers the remaining kind and action pairs (for example `conflict` on `brand`, `load` or `read`); the exhaustive table is in [`core/test/errors.test.ts`](../core/test/errors.test.ts). Pages should keep their own copy for page-specific recovery, such as *Load their version*, and use this helper for the base notice.

## The bridge

`window.hqServices.social.call(route, params)` takes one of six closed routes. The renderer names the route and its parameters; the main process in [`apps/desktop/electron/services.ts`](../../../apps/desktop/electron/services.ts) owns everything else.

| Route | Request | Class |
| --- | --- | --- |
| `workspace` | `GET /api/workspace` | read |
| `sample` | `GET /api/sample/<tool>` | read |
| `run` | `GET /api/runs/<id>` | read |
| `saveContent` | `POST /api/content` | content write |
| `addBrand` | `POST /api/brands` | content write |
| `submitRun` | `POST /api/runs` | execution |

A response is `{ok: true, status, body, replayed}` for **any** HTTP answer, including 4xx and 5xx (branch on `status`), or `{ok: false, kind: 'unavailable' | 'unknown'}` when no answer arrived. New routes are added only together with a new feature (planned: `setBrandProject`, `source`, `saveSource`, `archiveSource`, and the five publishing routes).

Main owns:

- **Endpoint.** Saved in the native app; HTTPS, or HTTP on `localhost`, `127.0.0.1` or `::1`. No credentials, query or fragment. The renderer never sees it.
- **Token.** The workspace `csrf` is cached per endpoint, sent as `X-Workspace-Token`, and removed from every body. The first write reads the workspace to learn it. If that read fails, no write is sent.
- **One 403 refresh, content routes only.** If `saveContent` or `addBrand` is refused with exactly `Reload the workspace before saving`, main re-reads the workspace and sends the same write once. Any other 403 is returned as it is. `submitRun` is never refreshed or resent.
- **Caps.** Requests are limited to 2,000,000 bytes. Responses are limited to 2,000,000 bytes, except the **workspace snapshot, which allows 16 MiB (16,777,216 bytes)** because it carries every draft body. A response over its cap is a lost response: `unavailable` on a read, `unknown` on a write.
- **Timeouts.** A whole-response deadline of 10 s for reads and 20 s for writes. No redirects are followed and no cookies are kept.

## Run HQ against a local HQ Social service

*Planned:* `services/social` is being built in parallel and may not be in your checkout yet. When it is, from `services/social`:

```sh
python3 -m social_service --data /path/outside/HQ/social --host 127.0.0.1 --port 8766
```

Keep `--data` outside the repository. The service is loopback-only, so no firewall or hosting change is involved. Then in HQ:

1. Open **Settings → Data sources**.
2. Choose **Change Social address**, enter `http://127.0.0.1:8766` and save.
3. Reload HQ. The Social status line changes from *Sample data · not set up* to *Set up · not checked*, and the views use the live port.

The service contract is [`iface.service.001`](../../../docs/engineering-specs/backend-assessment-social-20261103.md#hq-social-service-contract-v1-target). Fieldnotes speaks the same wire contract but is not reachable from HQ as deployed (finding B2-F2).
