import { createContext, useContext } from 'react';

/**
 * The status text the host gives a simulated return. A return carrying exactly this status is shown as
 * Simulated, never as reported by an agent. Null (the default) means this surface has no simulation.
 */
export const SimulationLabelContext = createContext<string | null>(null);

export function useSimulationLabel(): string | null {
  return useContext(SimulationLabelContext);
}
