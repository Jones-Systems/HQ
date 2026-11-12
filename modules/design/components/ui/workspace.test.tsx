// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { createToastStore, ToastStoreProvider } from '@hq/ui';
import type { ToastStore } from '@hq/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentId, VariantId } from '../src/contract.ts';
import {
  SYNTHETIC_BUTTON, SYNTHETIC_BUTTON_VARIANTS, SYNTHETIC_CARD, SYNTHETIC_CARD_VARIANTS, SYNTHETIC_MOTION, SYNTHETIC_SYSTEM,
} from '../src/fixtures.ts';
import { webCryptoDigest } from '../src/model/jcs.ts';
import { parseMotionStudy, sampleStudy } from '../src/model/motion.ts';
import { snapToSampleFrames } from '../src/model/proxy-frames.ts';
import { createFakeComponentRunner } from '../src/workspace/fake-runner.ts';
import { createFakeClock, createMemoryStorage } from '../src/workspace/fakes.ts';
import { ComponentLibrary } from '../src/workspace/library.ts';
import { ComponentsWorkspace } from './ComponentsWorkspace.tsx';
import type { ComponentsWorkspaceProps } from './ComponentsWorkspace.tsx';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-hq-motion');
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
});

async function seed() {
  const library = new ComponentLibrary(createMemoryStorage(), webCryptoDigest);
  const button = await library.saveSource(SYNTHETIC_BUTTON);
  const buttonVariants = await library.saveVariants(button, { componentId: button.componentId, sourceRevision: 1, variants: SYNTHETIC_BUTTON_VARIANTS });
  const card = await library.saveSource(SYNTHETIC_CARD);
  await library.saveVariants(card, { componentId: card.componentId, sourceRevision: 1, variants: SYNTHETIC_CARD_VARIANTS });
  await library.saveDesignSystem(SYNTHETIC_SYSTEM);
  await library.saveMotionStudy(SYNTHETIC_MOTION);
  return { library, button, buttonVariants };
}

function mount(library: ComponentLibrary, extra: Partial<ComponentsWorkspaceProps> = {}): { view: RenderResult; store: ToastStore } {
  const store = createToastStore();
  const view = render(<ToastStoreProvider store={store}>
    <ComponentsWorkspace library={library} clock={createFakeClock()} appearance="light" {...extra} />
  </ToastStoreProvider>);
  return { view, store };
}

const variantGroup = (view: RenderResult) => view.getByRole('radiogroup', { name: /Variants/u });
const variantRadio = (view: RenderResult, name: RegExp) => within(variantGroup(view)).getByRole('radio', { name });
const stageHost = (view: RenderResult) => view.container.querySelector<HTMLElement>('.hqc-surface > .hqc-frame') as HTMLElement;
const toasts = (store: ToastStore) => store.getSnapshot();

describe('library and variants', () => {
  it('lists components by name with the id as mono meta', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    await view.findByRole('radiogroup', { name: /Variants/u });
    const nav = view.getByRole('navigation', { name: 'Components' });
    expect(within(nav).getByText('Synthetic Button')).toBeTruthy();
    expect(within(nav).getByText('synthetic-button').className).toContain('hqc-mono');
    expect(within(nav).getByText('Synthetic Card')).toBeTruthy();
  });

  it('preselects Base when the session has no variant, so one tile is always checked', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    const base = await view.findByRole('radio', { name: /^Base/u });
    expect(base.getAttribute('aria-checked')).toBe('true');
    expect(within(variantGroup(view)).getAllByRole('radio', { checked: true })).toHaveLength(1);
    expect(within(variantGroup(view)).getAllByRole('radio')).toHaveLength(SYNTHETIC_BUTTON_VARIANTS.length + 1);
    expect(base.tabIndex).toBe(0);
  });

  it('restores the variant saved in the session', async () => {
    const { library, button, buttonVariants } = await seed();
    await library.saveSession(button, buttonVariants, 'danger-pill' as VariantId, {});
    const { view } = mount(library);
    const danger = await view.findByRole('radio', { name: /^Danger pill/u });
    expect(danger.getAttribute('aria-checked')).toBe('true');
    expect(variantRadio(view, /^Base/u).getAttribute('aria-checked')).toBe('false');
  });

  it('chooses with the arrow keys, Home and End, moves focus with the choice and persists it', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    const base = await view.findByRole('radio', { name: /^Base/u });
    base.focus();
    fireEvent.keyDown(base, { key: 'ArrowRight' });
    const primary = variantRadio(view, /^Primary/u);
    expect(primary.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(primary);
    expect(primary.tabIndex).toBe(0);
    expect(variantRadio(view, /^Base/u).tabIndex).toBe(-1);
    await waitFor(async () => expect((await library.getSession('synthetic-button' as ComponentId))?.variantId).toBe('primary'));

    fireEvent.keyDown(primary, { key: 'End' });
    expect(variantRadio(view, /^Disabled/u).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(variantRadio(view, /^Disabled/u), { key: 'ArrowRight' });
    expect(variantRadio(view, /^Base/u).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(variantRadio(view, /^Base/u), { key: 'ArrowLeft' });
    expect(variantRadio(view, /^Disabled/u).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(variantRadio(view, /^Disabled/u), { key: 'Home' });
    expect(variantRadio(view, /^Base/u).getAttribute('aria-checked')).toBe('true');
    await waitFor(async () => expect((await library.getSession('synthetic-button' as ComponentId))?.variantId).toBeNull());
  });

  it('clicking a tile selects it and the blueprint caption follows', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    await view.findByRole('radio', { name: /^Base/u });
    expect(stageHost(view).textContent).toContain('Base · “Continue”');
    fireEvent.click(variantRadio(view, /^Danger pill/u));
    expect(stageHost(view).textContent).toContain('Danger pill · “Delete”');
  });

  it('keeps the selection when the session cannot be saved and says so in one error toast', async () => {
    const { library } = await seed();
    vi.spyOn(library, 'saveSession').mockRejectedValue(new Error('storage offline'));
    const { view, store } = mount(library);
    await view.findByRole('radio', { name: /^Base/u });
    fireEvent.click(variantRadio(view, /^Primary/u));
    await waitFor(() => expect(toasts(store)).toHaveLength(1));
    const [saved] = toasts(store);
    expect(saved).toMatchObject({ tone: 'danger', title: 'Could not save your selection' });
    expect(saved?.description).toContain('kept for this session only');
    // The selection stands, and no persistent notice text was added to the screen.
    expect(variantRadio(view, /^Primary/u).getAttribute('aria-checked')).toBe('true');
    expect(view.container.textContent).not.toContain('could not be saved');
    expect(view.container.querySelector('.hqc-notice')).toBeNull();
    // A second failure updates the same toast instead of stacking another.
    fireEvent.click(variantRadio(view, /^Neutral small/u));
    await waitFor(() => expect(vi.mocked(library.saveSession).mock.calls.length).toBe(2));
    expect(toasts(store)).toHaveLength(1);
  });
});

describe('held stage', () => {
  it('says the preview is held once, outside the stage, and names the qualification gate under Why?', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    await view.findByRole('radio', { name: /^Base/u });
    expect(view.container.querySelectorAll('[data-held-notice]')).toHaveLength(1);
    expect(view.getAllByText('Preview held')).toHaveLength(1);
    expect(view.container.textContent).toContain('Props, variants, tokens and motion stay editable.');
    // The old debug lines that overlapped the controls are gone.
    expect(view.container.textContent).not.toContain('HELD ·');
    expect(view.container.textContent).not.toContain('scripted: held pending host qualification');
    // The notice is a sibling of the stage host, never inside it.
    expect(stageHost(view).querySelector('[data-held-notice]')).toBeNull();
    expect(stageHost(view).textContent).not.toContain('Preview held');
    const why = view.container.querySelector('.hqc-why') as HTMLElement;
    expect(why.querySelector('summary')?.textContent).toBe('Why?');
    expect(why.textContent).toContain('ac.component-static-enablement.001');
    expect(why.textContent).toContain('ac.component-scripted-enablement.001');
    expect(why.textContent).toContain('This component has a script');
  });

  it('draws the blueprint from metadata only: name, variant, label, size, resolved props and token swatches', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    await view.findByRole('radio', { name: /^Base/u });
    const stage = stageHost(view);
    expect(stage.textContent).toContain('Synthetic Button');
    expect(stage.textContent).toContain('Base · “Continue”');
    expect(stage.textContent).toContain('240 × 120');
    expect(stage.textContent).toContain('Blueprint · not a render');
    const props = within(stage).getByRole('list', { name: 'Resolved props' });
    expect(within(props).getAllByRole('listitem')).toHaveLength(Object.keys(SYNTHETIC_BUTTON.props).length);
    expect(props.textContent).toContain('tone primary');
    expect(props.textContent).toContain('radius 6');
    const swatches = within(stage).getByRole('list', { name: 'Tokens used' });
    expect(swatches.querySelectorAll('.hqc-swatch')).toHaveLength(4);
    expect(swatches.textContent).toContain('color.brand.primary');
    expect(swatches.textContent).toContain('+2 other');
  });

  it('inserts no component markup, style or script: no iframe, no element from the component, no shadow root', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    await view.findByRole('radio', { name: /^Base/u });
    const stage = stageHost(view);
    expect(stage.dataset.run).toBe('none');
    expect(stage.querySelector('button, .btn, .label, [data-motion-target], iframe, style, script, template, link, object, embed')).toBeNull();
    expect(view.container.querySelector('iframe')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(stage.shadowRoot).toBeNull();
    for (const element of Array.from(view.container.querySelectorAll('*'))) expect(element.shadowRoot).toBeNull();
    expect(view.container.innerHTML).not.toContain(SYNTHETIC_BUTTON.markup);
    expect(view.container.innerHTML).not.toContain('data-motion-target');
    expect(view.container.innerHTML).not.toContain('srcdoc');
    expect(view.container.textContent).not.toContain('--prop-radius');
    expect(view.container.textContent).not.toContain('font-weight-bold');
    // Every variant and a changed prop keep it that way.
    for (const name of [/^Primary/u, /^Neutral small/u, /^Danger pill/u, /^Disabled/u]) {
      fireEvent.click(variantRadio(view, name));
      expect(stage.querySelector('button, .btn, [data-motion-target], iframe, style, script')).toBeNull();
    }
  });

  it('never transforms or animates the transform of the stage host or its ancestors', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    await view.findByRole('radio', { name: /^Base/u });
    fireEvent.click(variantRadio(view, /^Danger pill/u));
    for (let element: HTMLElement | null = stageHost(view); element !== null && element !== document.body; element = element.parentElement) {
      expect(element.style.transform, element.className).toBe('');
      expect(element.style.animation, element.className).toBe('');
      expect(element.className).not.toMatch(/hq-(enter|lift|press|stagger|flash)/u);
    }
    // Presets restyle the blueprint inside the host and leave the host alone.
    fireEvent.click(view.getByRole('radio', { name: '480' }));
    fireEvent.click(view.getByRole('radio', { name: 'Dark' }));
    expect(stageHost(view).dataset.backdrop).toBe('dark');
    expect(stageHost(view).style.transform).toBe('');
  });

  it('restyles the blueprint with the backdrop and width presets, by keyboard too', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    await view.findByRole('radio', { name: /^Base/u });
    const backdrop = view.getByRole('radiogroup', { name: 'Backdrop' });
    expect(within(backdrop).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Grid', 'Light', 'Dark']);
    expect(stageHost(view).dataset.backdrop).toBe('grid');
    const grid = within(backdrop).getByRole('radio', { name: 'Grid' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(stageHost(view).dataset.backdrop).toBe('light');
    fireEvent.click(within(backdrop).getByRole('radio', { name: 'Dark' }));
    expect(stageHost(view).dataset.backdrop).toBe('dark');
    const widths = view.getByRole('radiogroup', { name: 'Width' });
    expect(within(widths).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Fit', '320', '480']);
    const frame = () => view.container.querySelector<HTMLElement>('.hqc-bp-frame') as HTMLElement;
    expect(frame().style.width).toBe('240px');
    fireEvent.click(within(widths).getByRole('radio', { name: '320' }));
    expect(frame().style.width).toBe('320px');
    expect(stageHost(view).textContent).toContain('320 × 120');
    fireEvent.click(within(widths).getByRole('radio', { name: '480' }));
    expect(frame().style.width).toBe('480px');
  });

  it('cross-fades the blueprint content on a variant change and flashes the values that changed', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    await view.findByRole('radio', { name: /^Base/u });
    const before = view.container.querySelector('.hqc-bp-content') as HTMLElement;
    expect(before.className).toContain('hq-enter-fade');
    expect(view.container.querySelectorAll('.hq-flash')).toHaveLength(0);
    fireEvent.click(variantRadio(view, /^Danger pill/u));
    const after = view.container.querySelector('.hqc-bp-content') as HTMLElement;
    expect(after).not.toBe(before);
    expect(after.className).toContain('hq-enter-fade');
    const flashed = Array.from(view.container.querySelectorAll('.hqc-bp-props .hq-flash')).map((chip) => chip.textContent?.trim());
    expect(flashed).toEqual(['label Delete', 'tone danger', 'radius 24']);
  });

  it('lets a qualified runner take over the stage: no blueprint, no held notice, a truthful FAKE label', async () => {
    const { library } = await seed();
    const runner = createFakeComponentRunner();
    const { view } = mount(library, { runner });
    await waitFor(() => expect(runner.calls).toContain('place'));
    expect(stageHost(view).dataset.run).toBe('active');
    expect(view.container.querySelector('[data-held-blueprint]')).toBeNull();
    expect(view.container.querySelector('[data-held-notice]')).toBeNull();
    expect(view.container.querySelector('.hqc-fake')?.textContent).toBe('FAKE · synthetic only · not containment evidence');
    expect(view.container.querySelector('iframe')).toBeNull();
    fireEvent.click(variantRadio(view, /^Danger pill/u));
    await waitFor(() => expect(runner.calls.filter((call) => call === 'render')).toHaveLength(2));
  });
});

describe('controls', () => {
  it('shows each prop with its type and constraint hint, and an overridden dot with Reset once edited', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    await view.findByRole('radio', { name: /^Base/u });
    const controls = view.getByRole('region', { name: 'Props' });
    expect(controls.textContent).toContain('0–24, step 1');
    expect(controls.textContent).toContain('≤ 60 chars');
    expect(controls.querySelectorAll('.hqc-dot')).toHaveLength(0);
    expect(within(controls).queryByRole('button', { name: 'Reset all' })).toBeNull();
    const radius = within(controls).getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(radius, { target: { value: '12' } });
    expect(controls.querySelectorAll('.hqc-dot')).toHaveLength(1);
    expect(within(controls).getByRole('button', { name: 'Reset radius' })).toBeTruthy();
    expect(within(controls).getByRole('button', { name: 'Reset all' })).toBeTruthy();
    expect(view.container.querySelector('.hqc-bp-props .hq-flash')?.textContent?.trim()).toBe('radius 12');
    await waitFor(async () => expect((await library.getSession('synthetic-button' as ComponentId))?.overrides).toEqual({ radius: 12 }));
    fireEvent.click(within(controls).getByRole('button', { name: 'Reset all' }));
    expect(controls.querySelectorAll('.hqc-dot')).toHaveLength(0);
    expect(within(controls).queryByRole('button', { name: 'Reset all' })).toBeNull();
    expect(view.container.querySelector('.hqc-bp-props')?.textContent).toContain('radius 6');
  });

  it('rejects an out-of-range value with a field error beside the field, keeps the last valid value and clears on Reset', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    await view.findByRole('radio', { name: /^Base/u });
    const controls = view.getByRole('region', { name: 'Props' });
    const radius = within(controls).getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(radius, { target: { value: '40' } });
    const error = within(controls).getByText('Use a number from 0 to 24.');
    expect(radius.getAttribute('aria-invalid')).toBe('true');
    expect(radius.getAttribute('aria-describedby')).toContain(error.closest('p')?.id ?? 'missing');
    expect(radius.value).toBe('40');
    // The render input still has the last valid value.
    expect(view.container.querySelector('.hqc-bp-props')?.textContent).toContain('radius 6');
    expect((await library.getSession('synthetic-button' as ComponentId))?.overrides ?? {}).toEqual({});
    fireEvent.click(within(controls).getByRole('button', { name: 'Reset radius' }));
    expect(within(controls).queryByText('Use a number from 0 to 24.')).toBeNull();
    expect(radius.getAttribute('aria-invalid')).toBeNull();
    expect(radius.value).toBe('6');
    fireEvent.change(radius, { target: { value: '40' } });
    fireEvent.change(radius, { target: { value: '8' } });
    expect(within(controls).queryByText('Use a number from 0 to 24.')).toBeNull();
    expect(view.container.querySelector('.hqc-bp-props')?.textContent).toContain('radius 8');
  });

  it('holds the full props table and variant overrides under Spec', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    await view.findByRole('radio', { name: /^Base/u });
    const spec = view.container.querySelector('.hqc-spec') as HTMLDetailsElement;
    expect(spec.querySelector('summary')?.textContent).toBe('Spec');
    expect(spec.textContent).toContain('Variant overrides');
    expect(spec.textContent).toContain('radius: 24');
  });
});

describe('rate taste', () => {
  it('sends the component, revision and variant on the stage, and is absent when no handler is supplied', async () => {
    const { library } = await seed();
    const absent = mount(library);
    await absent.view.findByRole('radio', { name: /^Base/u });
    expect(absent.view.queryByRole('button', { name: 'Rate taste' })).toBeNull();
    cleanup();

    const sent: unknown[] = [];
    const { view } = mount(library, { onSendToTaste: (subject) => { sent.push(subject); } });
    await view.findByRole('radio', { name: /^Base/u });
    fireEvent.click(view.getByRole('button', { name: 'Rate taste' }));
    fireEvent.click(variantRadio(view, /^Danger pill/u));
    fireEvent.click(view.getByRole('button', { name: 'Rate taste' }));
    expect(sent).toEqual([
      { componentId: 'synthetic-button', name: 'Synthetic Button', revision: 1, variantId: null, variantName: 'Base' },
      { componentId: 'synthetic-button', name: 'Synthetic Button', revision: 1, variantId: 'danger-pill', variantName: 'Danger pill' },
    ]);
  });
});

describe('loading', () => {
  it('shows a state view only when nothing has loaded, and recovers on Try again', async () => {
    const { library } = await seed();
    const failing = vi.spyOn(library, 'listComponents').mockRejectedValue(new Error('storage offline'));
    const { view } = mount(library);
    const state = await view.findByText('Could not load components');
    expect(state.closest('[data-state="error"]')).not.toBeNull();
    expect(view.container.textContent).toContain('storage offline');
    failing.mockRestore();
    fireEvent.click(view.getByRole('button', { name: 'Try again' }));
    await view.findByRole('radio', { name: /^Base/u });
    expect(view.queryByText('Could not load components')).toBeNull();
  });

  it('keeps what loaded and shows an inline notice when a later load fails', async () => {
    const { library } = await seed();
    const store = createToastStore();
    const tree = (current: ComponentLibrary) => <ToastStoreProvider store={store}>
      <ComponentsWorkspace library={current} clock={createFakeClock()} appearance="light" />
    </ToastStoreProvider>;
    const view = render(tree(library));
    await view.findByRole('radio', { name: /^Base/u });
    const other = new ComponentLibrary(createMemoryStorage(), webCryptoDigest);
    vi.spyOn(other, 'listComponents').mockRejectedValue(new Error('storage offline'));
    view.rerender(tree(other));
    const notice = await view.findByRole('alert');
    expect(notice.textContent).toContain('Could not load components');
    expect(notice.closest('[data-state]')).toBeNull();
    expect(notice.className).toContain('hq-notice');
    expect(variantRadio(view, /^Base/u)).toBeTruthy();
    expect(within(notice).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('tokens', () => {
  const openTokens = async (view: RenderResult) => {
    await view.findByRole('radio', { name: /^Base/u });
    await act(async () => { view.getByRole('tab', { name: 'Tokens' }).click(); });
  };

  it('copies a token id on click and confirms with a success toast', async () => {
    const { library } = await seed();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { view, store } = mount(library);
    await openTokens(view);
    await act(async () => { view.getByRole('button', { name: 'Copy color.brand.primary, #3b5bdb' }).click(); });
    expect(writeText).toHaveBeenCalledWith('color.brand.primary');
    expect(toasts(store)).toHaveLength(1);
    expect(toasts(store)[0]).toMatchObject({ tone: 'success', title: 'Copied color.brand.primary', meta: '#3b5bdb' });
  });

  it('shows the value in an info toast when the clipboard is missing or refuses', async () => {
    const { library } = await seed();
    const { view, store } = mount(library);
    await openTokens(view);
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await act(async () => { view.getByRole('button', { name: 'Copy color.brand.danger, #c92a2a' }).click(); });
    expect(toasts(store)[0]).toMatchObject({ tone: 'info', title: 'color.brand.danger · #c92a2a' });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true });
    await act(async () => { view.getByRole('button', { name: 'Copy space.2, 8px' }).click(); });
    expect(toasts(store)[0]).toMatchObject({ tone: 'info', title: 'space.2 · 8px' });
  });

  it('draws a swatch grid by group and type, keeping alias info', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    await openTokens(view);
    expect(view.container.querySelectorAll('.hqc-token-grid')).toHaveLength(6);
    expect(view.getByRole('button', { name: 'Copy color.action.primary, #3b5bdb' }).textContent).toContain('via {color.brand.primary}');
    expect(view.container.querySelector('table')).toBeNull();
  });
});

describe('motion', () => {
  const study = parseMotionStudy(SYNTHETIC_MOTION);
  const openMotion = async (view: RenderResult) => {
    await view.findByRole('radio', { name: /^Base/u });
    await act(async () => { view.getByRole('tab', { name: 'Motion' }).click(); });
    await view.findByText(/Proxy · the component itself is held/u);
  };
  const box = (view: RenderResult, target: string) => view.container.querySelector(`[data-target="${target}"]`) as HTMLElement;
  const scrubTo = (view: RenderResult, ms: number) => fireEvent.change(view.getByRole('slider'), { target: { value: String(ms) } });

  it('plays the study on a labelled HQ-drawn proxy with the exact sampled opacity and translate', async () => {
    const { library } = await seed();
    const { view } = mount(library);
    await openMotion(view);
    expect(view.container.querySelector('iframe')).toBeNull();
    expect(view.container.querySelectorAll('[data-target]')).toHaveLength(2);
    scrubTo(view, 250);
    const frame = sampleStudy(study, 250);
    expect(Number(box(view, 'card').style.opacity)).toBeCloseTo(frame['card-opacity'] as number, 6);
    expect(box(view, 'card').style.transform).toContain(`translateY(${frame['card-rise']}px)`);
    expect(box(view, 'badge').style.transform).toContain(`scale(${frame['badge-pop']})`);
    expect(box(view, 'card').style.transition).toBe('');
    expect(view.container.querySelector('.hqc-proxy-label')?.textContent).not.toContain('reduced motion');
  });

  it('under reduced motion, playback keeps exact time and the proxy jumps to sampled frames', async () => {
    document.documentElement.setAttribute('data-hq-motion', 'reduce');
    const { library } = await seed();
    const { view } = mount(library);
    await openMotion(view);
    scrubTo(view, 250);
    expect(view.getByRole('slider').getAttribute('aria-valuetext')).toBe('250 of 600 milliseconds');
    const snapped = sampleStudy(study, snapToSampleFrames(250, 600));
    const exact = sampleStudy(study, 250);
    expect(snapToSampleFrames(250, 600)).toBe(240);
    expect(Number(box(view, 'card').style.opacity)).toBeCloseTo(snapped['card-opacity'] as number, 6);
    expect(Math.abs(Number(box(view, 'card').style.opacity) - (exact['card-opacity'] as number))).toBeGreaterThan(1e-4);
    expect(box(view, 'card').style.transition).toBe('');
    expect(view.container.querySelector('.hqc-proxy-label')?.textContent).toContain('reduced motion');
  });

  it('saves an edited draft as a new revision and confirms with a toast', async () => {
    const { library } = await seed();
    const { view, store } = mount(library);
    await openMotion(view);
    const save = view.getByRole('button', { name: 'Save as new revision' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(view.getByRole('button', { name: /card-opacity keyframe at 0%/u }));
    fireEvent.click(view.getByRole('button', { name: 'ease-in' }));
    expect(view.getByText('Unsaved draft')).toBeTruthy();
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); });
    await waitFor(() => expect(toasts(store)).toHaveLength(1));
    expect(toasts(store)[0]).toMatchObject({ tone: 'success', title: 'Saved “Card entrance” as r2' });
    await waitFor(() => expect(view.queryByText('Unsaved draft')).toBeNull());
  });

  it('says when saving failed and keeps the draft', async () => {
    const { library } = await seed();
    vi.spyOn(library, 'saveMotionStudy').mockRejectedValue(new Error('storage offline'));
    const { view, store } = mount(library);
    await openMotion(view);
    fireEvent.click(view.getByRole('button', { name: /card-opacity keyframe at 0%/u }));
    fireEvent.click(view.getByRole('button', { name: 'ease-in' }));
    await act(async () => { (view.getByRole('button', { name: 'Save as new revision' }) as HTMLButtonElement).click(); });
    await waitFor(() => expect(toasts(store)).toHaveLength(1));
    expect(toasts(store)[0]).toMatchObject({ tone: 'danger', title: 'Could not save the motion study' });
    expect(view.getByText('Unsaved draft')).toBeTruthy();
  });
});
