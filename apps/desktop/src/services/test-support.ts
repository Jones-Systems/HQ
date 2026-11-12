import { screen, waitFor, within } from '@testing-library/react';

/**
 * The status word in a Work or Social strip (`Unavailable`, `Sample data`, `Set up`, `Reachable`, `Unreachable`).
 * The region is queried again on every attempt because the connecting skeleton and the settled surface are different
 * elements with the same name.
 */
export function findServiceStatus(domain: 'Work' | 'Social', label: string): Promise<HTMLElement> {
  return waitFor(() => within(screen.getByRole('region', { name: `${domain} service` }))
    .getByText(label, { selector: '.service-status .hq-status-label' }));
}
