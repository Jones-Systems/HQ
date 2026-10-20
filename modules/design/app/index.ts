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
 * Registered capabilities: none. There is no transport, dispatch slot for requests, discovery source
 * adapter, refresh-on-open, preview, preload bridge, credential or durable store. Chrome state persists
 * through a guarded `window.localStorage` (null when access throws, which T14 reports and survives).
 * Sections run over their own labelled in-memory fakes until the store adapters are wired.
 */
import type { ComponentType } from 'react';
import type { ModulePort } from '@hq/contracts';
import type { DesignDomain } from '../ui/contract.ts';
import { createProductionDesignDomain } from '../ui/index.ts';
import { createDeactivate, guardedLocalStorage } from './compose/session.ts';
import './compose/chrome-reset.css';

export const designDomain: DesignDomain<ComponentType<ModulePort>> = createProductionDesignDomain({ storage: guardedLocalStorage() });

export const designPresentation = designDomain.presentation;

/** Idempotent flush of Design's chrome state. Touches only `hq.design.ui-session.v1:*` keys and never submits work. */
export const designDeactivate: () => void = createDeactivate(designDomain);

export type { DesignDomain } from '../ui/contract.ts';
