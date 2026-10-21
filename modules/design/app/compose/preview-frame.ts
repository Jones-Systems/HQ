/** Geometry for the live preview frame. The desktop host repeats the fit authoritatively for native bounds. */
export interface FrameBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface FrameFit { readonly width: number; readonly height: number; readonly scale: number }

/** The frame never enlarges a page past its logical viewport; spare width stays HQ surface. */
export const MAX_FRAME_SCALE = 1;
export const MIN_STAGE_HEIGHT = 240;
/** Space kept between the workbench and the scrollport edges when the panel is revealed. */
export const STAGE_GUTTER = 16;

/** Largest box with the viewport's aspect that fits the available width and height, without upscaling. */
export function fitFrame(available: { readonly width: number; readonly height: number }, viewport: { readonly w: number; readonly h: number }): FrameFit {
  const width = Math.max(0, Math.floor(available.width)), height = Math.max(0, Math.floor(available.height));
  const scale = Math.max(0, Math.min(width / viewport.w, height / viewport.h, MAX_FRAME_SCALE));
  return { width: Math.min(width, Math.round(viewport.w * scale)), height: Math.min(height, Math.round(viewport.h * scale)), scale };
}

/**
 * Height available to the stage so the panel's controls, the frame and its caption fit in one scrollport
 * once the panel is scrolled to its start. `above` and `below` are the panel chrome around the stage.
 */
export function stageHeightBudget(scrollportHeight: number, above: number, below: number): number {
  return Math.max(MIN_STAGE_HEIGHT, Math.floor(scrollportHeight - above - below - 2 * STAGE_GUTTER));
}

/**
 * The native view cannot be clipped, so it is shown only while the whole frame is inside every clip box.
 * Half a pixel absorbs fractional layout; the host rounds bounds to whole DIP.
 */
export function frameFullyVisible(frame: FrameBox, clips: readonly FrameBox[]): boolean {
  if (frame.width <= 0 || frame.height <= 0) return false;
  const slack = 0.5;
  return clips.every((clip) => frame.x >= clip.x - slack && frame.y >= clip.y - slack
    && frame.x + frame.width <= clip.x + clip.width + slack && frame.y + frame.height <= clip.y + clip.height + slack);
}

/** Short, actionable wording for preview transport failures; unknown messages pass through unchanged. */
export function describePreviewError(message: string): string {
  const match = /^Preview (stale|blocked|unavailable): ([a-z-]+)$/u.exec(message);
  if (!match) return message;
  const [, kind, reason] = match;
  if (kind === 'stale' && reason === 'navigation') return 'The page changed before that finished. Nothing was saved; try again.';
  if (kind === 'stale') return `The page was still changing, so nothing was saved. Try again once it settles (${reason}).`;
  if (kind === 'blocked' && reason === 'navigation') return 'Blocked a navigation that leaves this site.';
  if (reason === 'capture-timeout') return 'Capture timed out. Nothing was saved; try again.';
  return message;
}
