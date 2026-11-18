// Hand-written declarations for the verbatim upstream ordering.js (see PROVENANCE.md).

export interface Positioned { id: string; position: number; created_at: string }
export interface Placed extends Positioned { status: string }
export type DropAnchors = { after_id: string } | { before_id: string } | { place: 'top' };
export type MoveAnchors = { after_id: string } | { before_id: string } | { place: 'top' | 'bottom' };

export function sortByPosition<T extends Positioned>(items: readonly T[]): T[];
export function anchorsForDrop(visibleIds: readonly string[], index: number): DropAnchors;
export function anchorsToRestore(allIdsInStatus: readonly string[], id: string): DropAnchors;
export function projectMove(items: readonly Placed[], id: string, status: string, anchors: MoveAnchors): Map<string, { status: string; position: number }> | null;
export function stepAnchors(visibleIds: readonly string[], id: string, delta: number): DropAnchors | null;
