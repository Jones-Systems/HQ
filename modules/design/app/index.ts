/// <reference lib="es2024.string" />
// The composed Taste dependency uses String.isWellFormed; include its declarations for shell consumers.
/**
 * Production entry for Design (HQD-INT-COMPOSE). The HQ shell mounts exactly this:
 *
 *   import { designDomain, designPresentation, designDeactivate } from '../../../modules/design/app/index.ts';
 *   // slot:        design: designDomain.Component
 *   // presentation: { design: designPresentation }   // 'fill'
 *   // deactivate:   { design: designDeactivate }     // call when leaving Design; idempotent, never submits
 *
 * Built once at module scope so chrome state outlives every mount of the view (keep-alive). Renderer/Vite
 * only: the section registry is the build-time glob of `modules/design/<id>/design-module.ts`.
 *
 * Document storage uses the desktop bridge when present. Transport and dispatch remain none;
 * discovery source adapters and refresh-on-open remain unavailable. Chrome state persists
 * through a guarded `window.localStorage` (null when access throws, which T14 reports and survives).
 * Nine sections use device storage when bridged; otherwise they retain labelled in-memory fakes.
 */
import { createElement, type ComponentType } from 'react';
import type { ModulePort } from '@hq/contracts';
import type { DesignDomain } from '../ui/contract.ts';
import { createProductionDesignDomain } from '../ui/index.ts';
import { createDeactivate, guardedLocalStorage } from './compose/session.ts';
import './compose/chrome-reset.css';
import { createBridgeWorkspaceDocuments } from './compose/bridge-documents.ts';
import { createDesignWorkspace } from './compose/workspace.ts';
import { DesignWorkspaceContext } from './compose/workspace-context.tsx';

const transport = globalThis.window?.hqServices?.design;
const documents = typeof transport === 'object' && transport !== null && typeof transport.call === 'function'
  ? createBridgeWorkspaceDocuments(transport) : null;
const workspace = createDesignWorkspace(documents);
const domain = createProductionDesignDomain({ storage: guardedLocalStorage() });
const Component: ComponentType<ModulePort> = (props) => createElement(DesignWorkspaceContext.Provider, { value: workspace }, createElement(domain.Component, props));
export const designDomain: DesignDomain<ComponentType<ModulePort>> = { ...domain, Component };

export const designPresentation = designDomain.presentation;

/** Idempotent flush of Design's chrome state. Touches only `hq.design.ui-session.v1:*` keys and never submits work. */
export const designDeactivate: () => void = createDeactivate(designDomain);

export type { DesignDomain } from '../ui/contract.ts';

export { createDesignReferenceProvider } from './references-provider/index.ts';
export type { DesignReferenceKind, DesignReferenceRecord, DesignReferenceRead, DesignReferenceReads } from './references-provider/index.ts';
