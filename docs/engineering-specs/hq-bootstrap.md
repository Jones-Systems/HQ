# HQ bootstrap

Artifact Type: engineering-spec
Artifact ID: spec.hq-bootstrap
Purpose: Establish the common desktop base for independently owned HQ domains.
Decision owner: M Jones
Consumers: HQ foundation and Design module lanes
Authority effect: none

## Scope and owner decision

The owner explicitly requests a public Jones-Systems/HQ repository, one Electron desktop app, and parallel Claude Opus/high implementation of Design. Social and Work are independently owned. This bootstrap supplies their shared mount points without implementing their products. Browser-capable React/TypeScript domain code sits behind a narrow desktop capability port. No separate Design desktop host.

## Bootstrap assignment T0

Create a minimal runnable Electron + React + TypeScript + Vite application. Own root manifests/configuration/lockfile, apps/desktop/, packages/contracts/, README.md and .gitignore. Do not edit shared planning documents or build Design features. Use current stable dependencies, exact lockfile, one root install. Shared contracts expose domain IDs design/social/work, appearance light/dark/system, stable project context and cross-domain reference envelopes. Keep shared contracts small; do not invent a universal task model.

Provide a slim rail Design above Social above Work, a module mount point, Light/Dark/System appearance and visible project context. Preserve last destination per domain. Social/Work are explicit unavailable module slots. Expose a Design placeholder until Design's independent sections integrate. The root owns root files until shared-shell custody is explicitly transferred.

Electron must have contextIsolation, sandbox, nodeIntegration false, deny unexpected navigation/windows/permissions, a restrictive CSP and a narrowly typed preload port. No generic filesystem/shell IPC, no provider credentials, no arbitrary remote code in the application renderer. Remote preview capability is a separately qualified Design surface. Closing UI must not cancel remote jobs. Electron source/build evidence is distinct from a Mac install/signing/notarization.

## Acceptance and checks

A fresh npm install, npm run typecheck, npm test and npm run build succeed. Add meaningful checks for appearance persistence/system following, independent domain destination restoration and strict reference/context handling. Document npm development and desktop build commands from the actual scripts. Node tests may cover pure state without inventing browser verification. Capture actual local UI evidence if the app/browser is available; report platform gaps. No sudo, service installation, signing, release, deployment or private-data access.

## Delivery

Publish the task branch and open a PR against main, link it to the native thread. Do not merge: coordinator integrates the cross-owner foundation after source/contract readback. No workflows until Jones shared Actions guidance has been read; CI may be supplied later. Preserve all unrelated changes. Root lock/config are one writer. This task is independent of the full Design campaign plan; its accepted output is the baseline needed by Design's consumers.
