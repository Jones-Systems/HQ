/// <reference lib="es2024.string" />
// The composed Taste dependency uses String.isWellFormed; include its declarations for shell consumers.
/**
 * Production entry for Design (HQD-INT-COMPOSE). Default exports preserve this mounting interface;
 * desktop capability wiring uses createDesignComposition:
 *
 *   import { designDomain, designPresentation, designDeactivate } from '../../../modules/design/app/index.ts';
 *   // slot:        design: designDomain.Component
 *   // presentation: { design: designPresentation }   // 'fill'
 *   // deactivate:   { design: designDeactivate }     // call when leaving Design; idempotent, never submits
 *
 * Each composition keeps chrome state across mounts. Desktop supplies enrolled source catalogs,
 * host-owned preview surfaces and an optional qualified Runs connection. Missing capabilities stay
 * unavailable. The unbridged workspace keeps its explicit in-memory example labels.
 * Chrome storage uses guarded localStorage; navigation and deactivation never dispatch work.
 */
import { createElement, type ComponentType } from 'react';
import type { ModulePort } from '@hq/contracts';
import type { DesignDomain } from '../ui/contract.ts';
import { createProductionDesignDomain } from '../ui/index.ts';
import { createDeactivate, guardedLocalStorage } from './compose/session.ts';
import './compose/chrome-reset.css';
import { createBridgeWorkspaceDocuments } from './compose/bridge-documents.ts';
import { createDesignReferenceReads } from './compose/reference-reads.ts';
import { createDesignWorkspace } from './compose/workspace.ts';
import { DesignWorkspaceContext } from './compose/workspace-context.tsx';
import type { DesignRuntimePorts } from './compose/runtime-ports.ts';

/** Desktop creates one composition with its enrolled capabilities; construction performs no launch or dispatch. */
export function createDesignComposition(ports: DesignRuntimePorts = {}) {
  const transport = globalThis.window?.hqServices?.design;
  const documents = ports.documents !== undefined ? ports.documents
    : typeof transport === 'object' && transport !== null && typeof transport.call === 'function'
      ? createBridgeWorkspaceDocuments(transport) : null;
  const workspace = createDesignWorkspace(documents, ports);
  const referenceReads = createDesignReferenceReads(documents);
  const domain = createProductionDesignDomain({ storage: guardedLocalStorage() });
  const Component: ComponentType<ModulePort> = (props) => createElement(DesignWorkspaceContext.Provider, { value: workspace }, createElement(domain.Component, props));
  const composed: DesignDomain<ComponentType<ModulePort>> = { ...domain, Component };
  const flush = createDeactivate(composed);
  return {
    designDomain: composed,
    designPresentation: composed.presentation,
    designReferenceReads: referenceReads,
    designDeactivate() { flush(); void workspace.interactive.deactivate(); },
  };
}

const production = createDesignComposition();
export const designDomain = production.designDomain;
export const designPresentation = production.designPresentation;
export const designReferenceReads = production.designReferenceReads;
export const designDeactivate = production.designDeactivate;
export type { DesignRuntimePorts, InteractiveCatalogPort, InteractiveCatalogItem } from './compose/runtime-ports.ts';

export type { DesignDomain } from '../ui/contract.ts';

export { createDesignReferenceProvider } from './references-provider/index.ts';
export type { DesignReferenceKind, DesignReferenceRecord, DesignReferenceRead, DesignReferenceReads } from './references-provider/index.ts';
