/** HTML embedding helpers shared by the review sandbox and product builds. */

/** JSON safe to embed in an HTML script element. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

/** Keeps authored script text from closing the element it is embedded in. */
export function embedScript(code: string): string {
  return code.replace(/<\/(script)/giu, '<\\/$1').replace(/<!--/gu, '<\\!--');
}

export function embedStyle(css: string): string {
  return css.replace(/<\/(style)/giu, '<\\/$1');
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

export function escapeText(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}
