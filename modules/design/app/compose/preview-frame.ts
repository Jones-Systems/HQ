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

/** Review column width and its gap to the workbench; the workbench border takes 2px from the stage. */
export const REVIEW_COLUMN = 320;
export const REVIEW_GAP = 16;
/** Narrowest stage worth placing beside the review column. */
export const MIN_BESIDE_STAGE = 360;

/**
 * Review sits beside the frame on wide panels, and on narrower ones whenever the column costs the page
 * little because the stage height already limits it (short windows, phone viewports). Then marks and
 * proposals stay in view with the live site instead of below it, where reaching them pauses the preview.
 * A taller stage only favours stacking, so a layout switch cannot flip the decision back.
 */
export function reviewBeside(panelWidth: number, stageHeight: number, viewport: { readonly w: number; readonly h: number }): boolean {
  if (panelWidth >= 1180) return true;
  const besideWidth = panelWidth - REVIEW_COLUMN - REVIEW_GAP - 2;
  if (besideWidth < MIN_BESIDE_STAGE) return false;
  const stacked = fitFrame({ width: panelWidth - 2, height: stageHeight }, viewport).scale;
  return stacked > 0 && fitFrame({ width: besideWidth, height: stageHeight }, viewport).scale >= 0.9 * stacked;
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
  if (kind === 'stale' && reason === 'mark-navigation') return 'That mark was not saved because the page changed. Mark it again.';
  if (kind === 'stale' && reason.startsWith('mark-')) return `That mark was not saved because HQ could not capture a stable frame. Mark it again (${reason.slice(5)}).`;
  if (kind === 'stale' && reason === 'navigation') return 'The page changed before that finished. Nothing was saved; try again.';
  if (kind === 'stale') return `The page was still changing, so nothing was saved. Try again once it settles (${reason}).`;
  if (kind === 'blocked' && reason === 'navigation') return 'Blocked a navigation that leaves this site.';
  if (reason === 'capture-timeout') return 'Capture timed out. Nothing was saved; try again.';
  return message;
}
