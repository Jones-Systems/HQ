import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useReducedMotion } from '@hq/ui';
import type { ComponentSource, PropValues, VariantId, VariantSet } from '../src/contract.ts';
import { primaryText } from '../src/model/blueprint.ts';
import { defaultProps } from '../src/model/props.ts';
import { limitChips, variantDiff } from '../src/model/variant-diff.ts';
import type { PropChip } from '../src/model/variant-diff.ts';

export interface VariantStripProps {
  readonly source: ComponentSource;
  readonly variants: VariantSet | null;
  /** The selected variant; null is Base, the declared defaults. */
  readonly variantId: VariantId | null;
  readonly onSelect: (variantId: VariantId | null) => void;
}

export interface VariantTile {
  readonly id: VariantId | null;
  readonly key: string;
  readonly name: string;
  readonly props: PropValues;
  readonly chips: readonly PropChip[];
}

/** Chips shown per tile before the rest are counted. */
const CHIP_LIMIT = 2;

/** Base first, then the saved variants in their stored order. */
export function variantTiles(source: ComponentSource, variants: VariantSet | null): readonly VariantTile[] {
  const defaults = defaultProps(source);
  return [
    { id: null, key: '~base', name: 'Base', props: defaults, chips: [] },
    ...(variants?.variants ?? []).map((variant) => ({
      id: variant.id, key: variant.id, name: variant.name, props: { ...defaults, ...variant.props }, chips: variantDiff(source, variant.props),
    })),
  ];
}

interface Glide { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/**
 * Variant strip: Base first, then each saved variant as a tile with a small blueprint and prop-diff chips. It is a
 * radio group, so the arrow keys, Home and End choose and focus a tile. A ring glides to the chosen tile; under
 * reduced motion the token durations are zero and it simply appears there.
 */
export function VariantStrip({ source, variants, variantId, onSelect }: VariantStripProps) {
  const tiles = variantTiles(source, variants);
  const selected = Math.max(0, tiles.findIndex((tile) => tile.id === variantId));
  const strip = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [glide, setGlide] = useState<Glide | null>(null);
  const [armed, setArmed] = useState(false);
  const [fade, setFade] = useState<'none' | 'start' | 'end' | 'both'>('none');
  const reduced = useReducedMotion();
  const labelId = useId();

  // Edge fades tell the eye that more tiles wait beyond the strip's edge.
  const updateFade = useCallback(() => {
    const element = strip.current;
    if (!element) return;
    const start = element.scrollLeft > 2;
    const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 2;
    setFade(start && end ? 'both' : start ? 'start' : end ? 'end' : 'none');
  }, []);

  const measure = useCallback(() => {
    updateFade();
    const tile = refs.current[selected];
    if (!tile) return;
    setGlide((previous) => {
      const next = { x: tile.offsetLeft, y: tile.offsetTop, width: tile.offsetWidth, height: tile.offsetHeight };
      return previous !== null && previous.x === next.x && previous.y === next.y && previous.width === next.width && previous.height === next.height ? previous : next;
    });
  }, [selected, updateFade]);

  useLayoutEffect(measure, [measure, tiles.length]);
  // The first placement never animates; later ones glide.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const element = strip.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);
  // A chosen tile is always in view. Only the strip scrolls, never the page around it.
  useEffect(() => {
    const scroller = strip.current;
    const tile = refs.current[selected];
    if (!scroller || !tile || typeof scroller.scrollTo !== 'function') return;
    const behavior = reduced ? 'auto' : 'smooth';
    if (tile.offsetLeft < scroller.scrollLeft) scroller.scrollTo({ left: Math.max(0, tile.offsetLeft - 8), behavior });
    else if (tile.offsetLeft + tile.offsetWidth > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollTo({ left: tile.offsetLeft + tile.offsetWidth - scroller.clientWidth + 8, behavior });
    }
  }, [selected, reduced]);

  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = tiles.length - 1;
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (selected + 1) % tiles.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (selected + last) % tiles.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
    const target = tiles[next];
    if (target === undefined) return;
    event.preventDefault();
    onSelect(target.id);
    refs.current[next]?.focus();
  };

  return <div className="hqc-variants">
    <div className="hqc-variants-head">
      <span id={labelId} className="hqc-eyebrow">Variants · {tiles.length - 1}</span>
      <span className="hqc-hint hqc-mono">{variants === null || variants.variants.length === 0 ? 'No saved variants' : 'Base is the declared defaults'}</span>
    </div>
    <div ref={strip} className="hqc-strip" role="radiogroup" aria-labelledby={labelId} data-glide={armed ? 'ready' : 'idle'} data-fade={fade} onScroll={updateFade}>
      {glide === null ? null : <span className="hqc-glide" aria-hidden="true"
        style={{ width: glide.width, height: glide.height, transform: `translate(${glide.x}px, ${glide.y}px)` }} />}
      {tiles.map((tile, index) => {
        const text = primaryText(source, tile.props);
        const { shown, hidden } = limitChips(tile.chips, CHIP_LIMIT);
        return <button
          key={tile.key}
          ref={(element) => { refs.current[index] = element; }}
          type="button"
          role="radio"
          aria-checked={index === selected}
          tabIndex={index === selected ? 0 : -1}
          className="hqc-tile"
          data-variant={tile.key}
          onClick={() => onSelect(tile.id)}
          onKeyDown={onKey}
        >
          <span className="hqc-tile-stage" aria-hidden="true">
            <span className="hqc-tile-frame" style={{ aspectRatio: `${source.size.width} / ${source.size.height}` }}>{text?.text ?? tile.name}</span>
          </span>
          <span className="hqc-tile-name">{tile.name}</span>
          <span className="hqc-tile-chips">
            {tile.id === null ? <span className="hqc-hint hqc-mono">declared defaults</span>
              : tile.chips.length === 0 ? <span className="hqc-hint hqc-mono">same as Base</span>
                : <>
                  {shown.map((chip) => <span key={chip.name} className={chip.changed ? 'hqc-chip' : 'hqc-chip hqc-chip-quiet'}
                    title={chip.changed ? undefined : 'Same as Base'}>{chip.text}</span>)}
                  {hidden.length === 0 ? null : <span className="hqc-chip hqc-chip-quiet" title={hidden.map((chip) => chip.text).join(', ')}>+{hidden.length}</span>}
                </>}
          </span>
        </button>;
      })}
    </div>
  </div>;
}
