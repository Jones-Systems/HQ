import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PaletteColors, PaletteId, PaletteRole } from '@hq/ui';
import { persist, type StoragePort } from '../state';
import {
  PALETTE_KEY, activeColors, applyPalette, readPaletteState, resetPaletteColor, resetPreset, selectPreset,
  serializePaletteState, setPaletteColor, type PaletteState,
} from './palette-state';

export interface PaletteController {
  readonly state: PaletteState;
  /** Colours of the selected preset with its overrides. */
  readonly colors: PaletteColors;
  /** False after a change could not be written; the change still applies for this session. */
  readonly saved: boolean;
  select(preset: PaletteId): void;
  setColor(role: PaletteRole, color: string): void;
  resetColor(role: PaletteRole): void;
  resetPreset(): void;
}

/**
 * Reads the stored palette once, applies it to `<html>` while the resolved theme is dark, and writes only after
 * an explicit change, so reading an old or malformed preference never overwrites it.
 */
export function usePalette(storage: StoragePort, dark: boolean): PaletteController {
  const [state, setState] = useState(() => readPaletteState(storage));
  const [saved, setSaved] = useState(true);
  const changed = useRef(false);
  const colors = useMemo(() => activeColors(state), [state]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    applyPalette(root, dark ? colors : null);
  }, [dark, colors]);
  useEffect(() => () => applyPalette(document.documentElement, null), []);
  useEffect(() => {
    if (!changed.current) return;
    setSaved(persist(storage, PALETTE_KEY, serializePaletteState(state)));
  }, [storage, state]);

  const update = useCallback((change: (previous: PaletteState) => PaletteState) => {
    changed.current = true;
    setState(change);
  }, []);
  return {
    state, colors, saved,
    select: (preset) => update((previous) => selectPreset(previous, preset)),
    setColor: (role, color) => update((previous) => setPaletteColor(previous, role, color)),
    resetColor: (role) => update((previous) => resetPaletteColor(previous, role)),
    resetPreset: () => update(resetPreset),
  };
}
