/** Said on a receipt for a run on the user's own input in the example workspace, where no Social service runs it. */
export const WAITS_HERE = 'No Social service is set up, so this run waits here.';
export const WAITS_HERE_DETAIL = 'Nothing was sent.';

/**
 * Asks the shell to open Settings at the Social service. The shell's own "Set up" button raises the same event, so
 * this changes no Social data and starts nothing.
 */
export function openSocialSetup(): void {
  window.dispatchEvent(new CustomEvent('hq-open-settings', { detail: { source: 'social' } }));
}
