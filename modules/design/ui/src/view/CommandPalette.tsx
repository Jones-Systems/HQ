import { useEffect, useRef, type Dispatch } from 'react';
import { filterCommands, type PaletteAction, type PaletteCommand, type PaletteEvent, type PaletteState } from '../palette.ts';

export interface CommandPaletteProps {
  readonly commands: readonly PaletteCommand[];
  readonly state: PaletteState;
  readonly dispatch: Dispatch<PaletteEvent>;
  readonly run: (action: PaletteAction) => void;
  readonly close: () => void;
}

/** Modal combobox + listbox. Arrow keys and hover only highlight; Enter or click runs. */
export function CommandPalette({ commands, state, dispatch, run, close }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const results = filterCommands(commands, state.query);
  const active = results[Math.min(state.active, results.length - 1)];
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (active) document.getElementById(`hqd-cmd-${active.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return <div className="hqd-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="hqd-palette" role="dialog" aria-modal="true" aria-label="Command palette"
      onKeyDown={(event) => {
        const move = (by: 'next' | 'previous' | 'first' | 'last') => { event.preventDefault(); dispatch({ type: 'move', by, count: results.length }); };
        switch (event.key) {
          case 'ArrowDown': move('next'); break;
          case 'ArrowUp': move('previous'); break;
          case 'PageDown': move('last'); break;
          case 'PageUp': move('first'); break;
          case 'Enter': event.preventDefault(); if (active) run(active.action); break;
          case 'Escape': event.preventDefault(); event.stopPropagation(); close(); break;
          case 'Tab': event.preventDefault(); break; // focus stays in the modal
        }
      }}>
      <input ref={inputRef} className="hqd-palette-input" role="combobox" aria-expanded="true" aria-autocomplete="list"
        aria-controls="hqd-palette-list" aria-activedescendant={active ? `hqd-cmd-${active.id}` : undefined}
        placeholder="Go to, open, show…" value={state.query} spellCheck={false}
        onChange={(event) => dispatch({ type: 'query', query: event.target.value })} />
      <ul id="hqd-palette-list" className="hqd-palette-list" role="listbox" aria-label="Commands">
        {results.length === 0 && <li className="hqd-palette-empty" role="presentation">No matching commands</li>}
        {results.map((command, index) => {
          const groupStart = index === 0 || results[index - 1]!.group !== command.group;
          return <li key={command.id} id={`hqd-cmd-${command.id}`} role="option" aria-selected={command === active}
            className="hqd-palette-option" data-group-start={groupStart ? command.group : undefined}
            onMouseMove={() => dispatch({ type: 'highlight', index, count: results.length })}
            onClick={() => run(command.action)}>
            <span>{command.title}</span><span className="hqd-palette-group">{command.group}</span>
          </li>;
        })}
      </ul>
    </div>
  </div>;
}
