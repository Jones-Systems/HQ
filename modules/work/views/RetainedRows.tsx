import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react';
import { Presence, useListMotion } from '@hq/ui';

export function RetainedRows({ children }: { children: ReactNode }) {
  const current = Children.toArray(children).filter(isValidElement);
  const [leaving, setLeaving] = useState<typeof current>([]);
  const [previous, setPrevious] = useState(current);
  const signature = current.map((c) => c.key).join('|');
  const previousSignature = previous.map((c) => c.key).join('|');
  useEffect(() => {
    if (signature === previousSignature) return;
    const keys = new Set(current.map((c) => c.key));
    setLeaving((old) => [...old.filter((c) => !keys.has(c.key)), ...previous.filter((c) => !keys.has(c.key))]);
    setPrevious(current);
  }, [signature, previousSignature]);
  const keys = new Set(current.map((c) => c.key));
  const exiting = [...leaving, ...previous.filter((c) => !keys.has(c.key))].filter((c, i, all) => !keys.has(c.key) && all.findIndex((x) => x.key === c.key) === i);
  const rows = [...current];
  for (const row of exiting) {
    const oldIndex = previous.findIndex((c) => c.key === row.key);
    rows.splice(Math.min(oldIndex < 0 ? rows.length : oldIndex, rows.length), 0, row);
  }
  const root = useListMotion<HTMLDivElement>(rows.map((c) => String(c.key)));
  return <div ref={root} className="wv-retained-rows">{rows.map((row) => <Presence key={row.key} show={keys.has(row.key)} motion="collapse"
    data-hq-motion-key={String(row.key)} inert={!keys.has(row.key) ? true : undefined}
    onExited={() => setLeaving((old) => old.filter((c) => c.key !== row.key))}>{row}</Presence>)}</div>;
}
