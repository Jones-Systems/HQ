import type { NavigationIntent, NavigationPort } from './contract.ts';
import { parseNavigationIntent } from './validate.ts';

/**
 * Hands a navigation intent to the shell. The intent is re-validated against
 * closed shapes first, and this module imports no dispatch, storage or status
 * port: moving between the Requests and Runs views cannot send or write.
 */
export function navigate(port: NavigationPort, intent: unknown): NavigationIntent {
  const parsed = parseNavigationIntent(intent);
  port.navigate(parsed);
  return parsed;
}
