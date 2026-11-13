import type { ReactNode } from 'react';

export interface NavNode {
  readonly id: string;
  readonly label: string;
  readonly destination: string | null;
  readonly icon?: ReactNode;
  readonly tag?: string;
  readonly count?: number;
  readonly children?: readonly NavNode[];
  readonly lazy?: boolean;
  readonly status?: 'loading' | 'error' | 'stale';
  readonly statusLabel?: string;
}

/** Project-bound metadata only. Source owners retain loading, cancellation and provider custody. */
export interface DomainNavSource {
  getSnapshot(projectId: string): readonly NavNode[];
  subscribe(projectId: string, listener: () => void): () => void;
  currentId(projectId: string, destination: string): string | null;
  activate?(projectId: string, nodeId: string): void;
}

export interface NavExpansionState {
  readonly projectId: string;
  readonly locationKey: string;
  readonly expandedIds: readonly string[];
}

export interface NavEntry {
  readonly node: NavNode;
  readonly parentId: string | null;
}

export interface NavModel {
  readonly nodes: readonly NavNode[];
  readonly entries: ReadonlyMap<string, NavEntry>;
  /** Invalid or excess data was omitted. Consumers must disclose this rather than imply a complete catalog. */
  readonly limited: boolean;
}
