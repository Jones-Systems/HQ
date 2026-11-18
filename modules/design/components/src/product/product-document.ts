import type { ComponentSource, RenderInput } from '../contract.ts';
import { embedScript, embedStyle, escapeText, scriptJson } from '../model/html.ts';
import { propsToCss } from '../model/props.ts';
import { tokensToCss } from '../model/tokens.ts';

/**
 * Standalone product build of one component configuration. It contains only
 * the component's own markup, styles and script plus resolved tokens and
 * props: no sandbox bootstrap, host channel, nonce, annotation or review code.
 * The removability scan (tests/removability.test.ts) enforces this.
 */
export function buildProductDocument(source: ComponentSource, input: RenderInput, title = source.name): string {
  if (input.componentId !== source.componentId || input.sourceRevision !== source.revision || input.sourceDigest !== source.digest) {
    throw new Error('Render input is bound to a different component revision.');
  }
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="color-scheme" content="${source.colorScheme}">`,
    `<title>${escapeText(title)}</title>`,
    `<style>${embedStyle(tokensToCss(input.tokens))}${embedStyle(propsToCss(source, input.props))}</style>`,
    `<style>${embedStyle(source.styles)}</style>`,
    '</head><body>',
    `<div id="component-root">${source.markup}</div>`,
    source.script.trim().length === 0 ? '' : [
      `<script>(function (root, props, tokens) {\n${embedScript(source.script)}\n})(`,
      "document.getElementById('component-root'), ",
      `Object.freeze(${scriptJson(input.props)}), Object.freeze(${scriptJson(input.tokens)}));</script>`,
    ].join(''),
    '</body></html>',
  ].join('');
}
