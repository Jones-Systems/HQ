import type { AnnotationDocument, AnnotationKind, AnnotationRef, Rect } from './contract.ts';

export const LOCAL_PATH_PLACEHOLDER = '[local path removed]';

const KIND_LABEL: Readonly<Record<AnnotationKind, string>> = {
  pick: 'Pick',
  cite: 'Cite',
  ink: 'Ink',
  box: 'Box',
  arrow: 'Arrow',
  label: 'Label',
};

// Local filesystem locations: file URLs, home-relative, common absolute roots,
// Windows drive and UNC paths. App routes such as "/settings" are not matched.
const LOCAL_PATH_PATTERNS: readonly RegExp[] = [
  /file:\/\/[^\s"'`<>)\]]*/giu,
  /(?<![\w.:/])~\/[^\s"'`<>)\]]*/gu,
  /(?<![\w.:/])\/(?:home|Users|root|tmp|var|private|mnt|Volumes|opt|srv|etc|media|run|nix|usr|Library|Applications|System)\/[^\s"'`<>)\]]*/gu,
  /(?<![\w])[A-Za-z]:[\\/][^\s"'`<>)\]]*/gu,
  /\\\\[^\s"'`<>)\]]+/gu,
];

/** Replaces anything that looks like a local filesystem location. */
export function redactLocalPaths(text: string): string {
  return LOCAL_PATH_PATTERNS.reduce((out, pattern) => out.replace(pattern, LOCAL_PATH_PLACEHOLDER), text);
}

export function containsLocalPath(text: string): boolean {
  return LOCAL_PATH_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    const hit = pattern.test(text);
    pattern.lastIndex = 0;
    return hit;
  });
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function fmt(n: number): string {
  return String(Math.round(n));
}

function rectText(rect: Rect): string {
  return `${fmt(rect.width)}×${fmt(rect.height)} at ${fmt(rect.x)},${fmt(rect.y)}`;
}

function subject(annotation: AnnotationRef): string {
  const { target } = annotation.anchor;
  switch (target.kind) {
    case 'element':
      return `element \`${oneLine(target.path)}\``;
    case 'text':
      return `“${oneLine(target.quote)}”`;
    case 'region':
      return annotation.kind === 'label' ? `at ${fmt(target.rect.x)},${fmt(target.rect.y)}` : rectText(target.rect);
    case 'ink': {
      const first = target.points[0]!;
      const last = target.points[target.points.length - 1]!;
      return annotation.kind === 'arrow'
        ? `from ${fmt(first.x)},${fmt(first.y)} to ${fmt(last.x)},${fmt(last.y)}`
        : `stroke of ${target.points.length} points near ${fmt(first.x)},${fmt(first.y)}`;
    }
  }
}

export interface CopyExportOptions {
  /** Display title for the header; never a path. */
  readonly title?: string;
  /** Limit to these letters, in document order. */
  readonly letters?: readonly string[];
}

/**
 * Plain-text Copy export: reference letters, kinds, quotes and notes.
 * Coordinates are source CSS px. Routes, capture digests and anything that
 * looks like a local filesystem path are excluded.
 */
export function formatCopyExport(document: AnnotationDocument, options: CopyExportOptions = {}): string {
  const selected = options.letters === undefined
    ? document.annotations
    : document.annotations.filter((a) => options.letters!.includes(a.letter));
  const revisit = new Set(document.revisit);
  const lines: string[] = [];
  lines.push(`Design annotations — ${options.title === undefined ? 'version' : oneLine(options.title)} (${document.versionId})`);
  if (selected.length === 0) lines.push('No annotations.');
  for (const annotation of selected) {
    const flag = revisit.has(annotation.id) ? ' [Revisit]' : '';
    lines.push(`${annotation.letter}. ${KIND_LABEL[annotation.kind]} ${subject(annotation)}${flag}`);
    const note = annotation.note.trim();
    if (note.length > 0) for (const line of note.split(/\r?\n/u)) lines.push(`   ${line}`);
  }
  const marked = selected.filter((a) => revisit.has(a.id)).map((a) => a.letter);
  if (marked.length > 0) lines.push(`Revisit: ${marked.join(', ')}`);
  return redactLocalPaths(lines.join('\n'));
}
