// React helpers over the happy-dom globals: mount, interact, await settled async work.

import './dom.ts';
import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { dom } from './dom.ts';

export interface Mounted<P> {
  readonly container: HTMLElement;
  rerender(props: P): Promise<void>;
  unmount(): Promise<void>;
}

export async function mount<P extends object>(component: ComponentType<P>, props: P): Promise<Mounted<P>> {
  const container = dom.document.createElement('div') as unknown as HTMLElement;
  dom.document.body.appendChild(container as never);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(createElement(component, props));
  });
  return {
    container,
    rerender: async (next) => {
      await act(async () => {
        root.render(createElement(component, next));
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Lets pending promise callbacks run and React commit their results. */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new dom.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event);
  });
  await settle();
}

export async function typeInto(input: Element, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value');
  await act(async () => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event);
  });
}

export async function submit(form: Element): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event);
  });
  await settle();
}

export function all(container: ParentNode, selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

export function one(container: ParentNode, selector: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`No element matches ${selector}`);
  return found;
}

export function byText(container: ParentNode, selector: string, text: string | RegExp): HTMLElement {
  const match = all(container, selector).find((element) => (typeof text === 'string' ? element.textContent === text : text.test(element.textContent ?? '')));
  if (match === undefined) throw new Error(`No ${selector} with text ${String(text)}`);
  return match;
}

export function textOf(container: ParentNode): string {
  return (container.textContent ?? '').replace(/\s+/gu, ' ').trim();
}
