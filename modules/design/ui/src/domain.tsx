import { useMemo, type ComponentType } from 'react';
import type { ModulePort } from '@hq/contracts';
import type { DesignDomain, ShellContextPort, ShellContextSnapshot, UiStatePort } from '../contract.ts';
import { createDesignCore, type DesignCore } from './domain-core.ts';
import type { ProjectCandidate } from './palette.ts';
import type { DesignRegistry } from './registry.ts';
import { FALLBACK_TOKENS } from './theme.ts';
import { DesignChrome } from './view/DesignChrome.tsx';
import type { SectionView } from './view/SectionOutlet.tsx';

export interface DesignDomainOptions {
  readonly registry: DesignRegistry<SectionView>;
  /** Chrome-state persistence. Null keeps state in memory only (reported in the inspector). */
  readonly storage: UiStatePort | null;
  /**
   * Shell context with theme tokens and project switching. When omitted, Design
   * adapts today's ModulePort: fallback tokens for its appearance and no
   * project switching. Root replaces this with the real shell adapter.
   */
  readonly shell?: ShellContextPort;
  readonly projects?: readonly ProjectCandidate[];
  readonly mac?: boolean;
}

function detectMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform || navigator.userAgent);
}

/** A ShellContextPort derived from ModulePort alone. Static per render; the shell re-renders on change. */
function useModulePortShell(port: ModulePort): ShellContextPort {
  return useMemo(() => {
    const snapshot: ShellContextSnapshot = {
      context: port.context, appearance: port.appearance, tokens: FALLBACK_TOKENS[port.appearance], desktop: port.desktop,
    };
    return { getSnapshot: () => snapshot, subscribe: () => () => undefined, requestProjectContext: null };
  }, [port.context, port.appearance, port.desktop]);
}

/**
 * Build the descriptor handed to the HQ shell. The core (sessions, keep-alive)
 * is created once here and outlives every mount of `Component`.
 */
export function createDesignDomain(options: DesignDomainOptions): DesignDomain<ComponentType<ModulePort>> & { readonly core: DesignCore } {
  const core = createDesignCore(options.storage);
  const mac = options.mac ?? detectMac();
  function DesignDomainView(port: ModulePort) {
    const adapted = useModulePortShell(port);
    return <DesignChrome port={port} shell={options.shell ?? adapted} core={core} registry={options.registry}
      mac={mac} {...(options.projects ? { projects: options.projects } : {})} />;
  }
  return {
    id: 'design', label: 'Design', order: 0, keepAlive: true, presentation: 'fill',
    Component: DesignDomainView,
    serialize: core.serialize,
    restore: core.restore,
    deactivate: core.deactivate,
    core,
  };
}
