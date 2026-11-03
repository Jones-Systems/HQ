// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SYNTHETIC_BUTTON, SYNTHETIC_MOTION } from '../src/fixtures.ts';
import { createSourceRevision } from '../src/model/source.ts';
import { webCryptoDigest } from '../src/model/jcs.ts';
import { resolveRenderInput } from '../src/model/props.ts';
import { parseMotionStudy } from '../src/model/motion.ts';
import { bindPropSlots } from '../src/model/prop-slots.ts';
import { createFakeComponentRunner } from '../src/workspace/fake-runner.ts';
import { createMemoryStorage, createFakeClock } from '../src/workspace/fakes.ts';
import { ComponentLibrary } from '../src/workspace/library.ts';
import { ComponentSurface } from './ComponentSurface.tsx';
import { ComponentsWorkspace } from './ComponentsWorkspace.tsx';
afterEach(cleanup);

it('binds literal text and attribute slots deterministically without executing values', () => {
  const template = document.createElement('template');
  template.innerHTML = '<button data-hq-text="label" data-hq-attr-disabled="disabled" data-hq-attr-aria-label="label"></button>';
  const props = { label: '<script>bad()</script>', disabled: false };
  bindPropSlots(template.content, props);
  expect(template.content.querySelector('script')).toBeNull();
  expect(template.content.querySelector('button')?.textContent).toBe(props.label);
  expect(template.content.querySelector('button')?.hasAttribute('disabled')).toBe(false);
  const first = template.innerHTML;
  bindPropSlots(template.content, props);
  expect(template.innerHTML).toBe(first);
  bindPropSlots(template.content, { ...props, disabled: true });
  expect(template.content.querySelector('button')?.hasAttribute('disabled')).toBe(true);
  template.innerHTML = '<button data-hq-text="label" data-hq-attr-onclick="label">original</button>';
  expect(() => bindPropSlots(template.content, props)).toThrow('Unsupported');
  expect(template.content.textContent).toBe('original');
  expect(() => bindPropSlots(template.content, {})).toThrow('Unknown');
});

it('production workspace is held with no srcdoc', async () => {
  const library = new ComponentLibrary(createMemoryStorage(), webCryptoDigest);
  await library.saveSource(SYNTHETIC_BUTTON);
  const view = render(<ComponentsWorkspace library={library} clock={createFakeClock()} appearance="light" />);
  await waitFor(() => expect(view.getByText(/HELD/)).toBeTruthy());
  expect(view.container.querySelector('iframe')).toBeNull();
});

it('injected fake receives render, place and motion and is closed on unmount', async () => {
  const source = await createSourceRevision(SYNTHETIC_BUTTON, 1, webCryptoDigest);
  const input = resolveRenderInput(source, null, null, {}, {});
  const runner = createFakeComponentRunner();
  const view = render(<ComponentSurface source={source} input={input} runner={runner} motion={{ study: parseMotionStudy(SYNTHETIC_MOTION), time: 0 }} />);
  await waitFor(() => expect(runner.calls).toContain('motion'));
  expect(runner.calls).toContain('place');
  expect(view.container.textContent).toContain('not containment evidence');
  expect(view.container.querySelector('iframe')).toBeNull();
  view.unmount();
  expect(runner.calls.at(-1)).toBe('close');
});

it('closes a render that completes after unmount', async () => {
  const source = await createSourceRevision(SYNTHETIC_BUTTON, 1, webCryptoDigest);
  const input = resolveRenderInput(source, null, null, {}, {});
  const fake = createFakeComponentRunner();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started = false;
  const runner = { ...fake, async render(request: Parameters<typeof fake.render>[0]) { started = true; await gate; return fake.render(request); } };
  const view = render(<ComponentSurface source={source} input={input} runner={runner} />);
  await waitFor(() => expect(started).toBe(true));
  view.unmount();
  await act(async () => { release(); await gate; });
  await waitFor(() => expect(fake.calls).toEqual(['render', 'close']));
});

 it('workspace forwards its injected fake and closes the view on tab switch', async () => {
  const library = new ComponentLibrary(createMemoryStorage(), webCryptoDigest);
  await library.saveSource(SYNTHETIC_BUTTON);
  const runner = createFakeComponentRunner();
  const view = render(<ComponentsWorkspace library={library} clock={createFakeClock()} appearance="light" runner={runner} />);
  await waitFor(() => expect(runner.calls).toContain('place'));
  expect(view.container.textContent).toContain('FAKE');
  expect(view.container.querySelector('iframe')).toBeNull();
  await act(async () => { view.getByRole('tab', { name: 'Tokens' }).click(); });
  expect(runner.calls.at(-1)).toBe('close');
});
