import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectSources } from './ProjectSources';
afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'hqServices'); });
it('enrolls gallery only on explicit submit and clears its private address afterward', async () => {
  const call = vi.fn(async (_route: string, _params: unknown) => ({ ok: true, value: [] }));
  Object.defineProperty(window, 'hqServices', { configurable: true, value: { sources: { call } } });
  render(<ProjectSources />);
  await waitFor(() => expect(call).toHaveBeenCalledWith('status', {}));
  fireEvent.change(screen.getByLabelText('Gallery base URL'), { target: { value: 'https://example.com/gallery/' } });
  expect(call).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Enroll gallery' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('enrollGallery', { baseUrl: 'https://example.com/gallery/', label: 'Gallery' }));
  await waitFor(() => expect((screen.getByLabelText('Gallery base URL') as HTMLInputElement).value).toBe(''));
  expect(call.mock.calls.some(([route]) => String(route).includes('send'))).toBe(false);
});
