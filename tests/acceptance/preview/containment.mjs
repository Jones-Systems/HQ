import assert from 'node:assert/strict';

// Containment of a held scaled capture. HQ cannot clip a native view with CSS, and the OS screenshot path is
// unavailable to qualification, so the composite is read from the browser compositor itself: with
// `disabled-by-default-viz.quads` its layer-tree snapshots list every layer with its window-space quad (pixels)
// and the clip and effect nodes it is drawn through. A preview's surface layer (the widget) belongs to the clip
// node of its host layer (the view, clipped by its native rounded corner); HQ's own surface does not.
export const containmentTraceCategories = ['disabled-by-default-viz.quads'];

/** The given process's compositor layer-tree snapshots from a Chrome JSON trace. */
export function compositorLayers(trace, pid) {
  const frames = [];
  for (const event of trace.traceEvents ?? trace) {
    const layers = event.pid === pid && event.name === 'LayerTreeHostImpl:snapshot' && event.args?.snapshot?.active_tree?.layers;
    if (!Array.isArray(layers)) continue;
    frames.push({ at: event.ts, layers: layers.map(({ layer_id: id, layer_quad: [x, y, , , right, bottom], ...layer }) => ({
      id, surface: 'surface_range' in layer, x, y, width: right - x, height: bottom - y,
      clip: layer.clip_tree_index, effect: layer.effect_tree_index })) });
  }
  return frames;
}
const near = (a, b) => Math.abs(a - b) <= 1;

/**
 * Every snapshot layer of the enlarged widget (`shot`, pixels) sits in the clip node of a host layer at one of
 * the fitted `placements` (pixels), never in the clip node of HQ's own `content`-sized surface.
 */
export function heldWidgetClipped(frames, { shot, content, placements }) {
  const at = (layer, rect) => ['x', 'y', 'width', 'height'].every(k => near(layer[k], rect[k]));
  const sized = (layer, size) => layer.surface && near(layer.width, size.width) && near(layer.height, size.height);
  const hqClips = new Set(frames.flatMap(f => f.layers.filter(l => sized(l, content)).map(l => l.clip)));
  let enlarged = 0;
  const sample = [];
  for (const frame of frames) for (const layer of frame.layers.filter(l => sized(l, shot))) {
    enlarged++;
    const host = frame.layers.find(h => !h.surface && h.clip === layer.clip && placements.some(p => at(h, p)));
    assert.ok(host && !hqClips.has(layer.clip), `The held widget is clipped by a host at a fitted frame: ${JSON.stringify({ at: frame.at, layer, layers: frame.layers, placements })}`);
    if (sample.length < 3) sample.push({ at: frame.at, widget: layer, host });
  }
  assert.ok(hqClips.size > 0, 'The trace shows HQ\'s own surface');
  assert.ok(enlarged > 0, `The browser compositor drew the held widget: ${JSON.stringify(frames.at(-1))}`);
  return { frames: frames.length, enlarged, hqClips: [...hqClips], sample };
}

/**
 * Native row on the image page (viewport 1024×720 at DPR 1). At a scaled frame the capture holds the widget at
 * the full shot size; the view keeps its fitted bounds, and the compositor draws the enlarged surface only
 * inside the clip of the view's layer at the frame. The frame-sized widget returns after the capture, after a
 * same-size move and a navigation during the hold, after a held screenshot times out and completes late, and
 * after Settings hides the view mid-capture. `d` supplies the runner's own host, page, trace and widget access.
 */
export async function heldCaptureContainment(d, { rect = { x: 0, y: 0, width: 704, height: 495 } } = {}) {
  await d.place(rect); await d.settle();
  const { viewport } = await d.view(), factor = await d.displayScale();
  const shot = { width: Math.round(viewport.w * viewport.dpr / factor), height: Math.round(viewport.h * viewport.dpr / factor) };
  const pixels = size => ({ width: Math.round(size.width * factor), height: Math.round(size.height * factor) });
  const fitted = (await d.view()).fitted.bounds, placements = [fitted], content = await d.contentSize();
  assert.ok(fitted.width < shot.width && fitted.height < shot.height, `The frame must be scaled: ${JSON.stringify({ fitted, shot })}`);
  assert.ok(!near(content.width, shot.width) || !near(content.height, shot.height), 'HQ\'s own surface must not share the shot size');
  const atFrame = async (label, frame = placements.at(-1)) => {
    const view = await d.view();
    assert.deepEqual(view.bounds, frame, `${label}: the view keeps the fitted bounds`);
    assert.deepEqual(view.fitted.bounds, frame, `${label}: the newest placement is the fitted one`);
    assert.deepEqual(await d.widget(), pixels(frame), `${label}: the widget is frame-sized`);
    return view;
  };
  const steps = { before: await atFrame('Before capture') };
  const paused = async (stage, during) => {
    await d.pauseAt(stage);
    const pending = d.capture(); pending.catch(() => {});
    try { await d.waitForPause(); return { during: await during(), pending }; }
    finally { await d.resume(); await d.pauseAt(null); }
  };
  const lateRestores = async () => (await d.traces()).filter(t => t.phase === 'shot-geometry:late-restored').length;
  const observe = async (predicate, milliseconds) => {
    for (const end = Date.now() + milliseconds; Date.now() < end; await d.delay(100)) if (await predicate()) return true;
    return predicate();
  };
  await d.traceStart(containmentTraceCategories);
  let trace;
  try {
    // 1. Held capture: the view is at the frame while the widget is at the full shot size.
    const blobs = await d.blobWrites();
    const held = await paused('first-capture', async () => ({ view: (await d.view()).bounds, widget: await d.widget() }));
    assert.deepEqual(held.during.view, fitted, 'The held capture leaves the view at the frame');
    assert.deepEqual(held.during.widget, pixels(shot), 'The held capture enlarges only the widget, to the full shot size');
    const accepted = await held.pending;
    assert.equal(accepted.ok, true, `Held capture accepted: ${JSON.stringify(accepted)}`);
    assert.equal(await d.blobWrites(), blobs + 1);
    steps.held = { during: held.during, digest: accepted.value.captureDigest, after: await atFrame('After the held capture') };

    // 2. A same-size move during the hold: the newest placement wins and the widget returns to the frame.
    const moved = { ...rect, y: rect.y + 40 };
    const move = await paused('first-capture', () => d.place(moved));
    const moveResult = await move.pending;
    placements.push((await d.view()).fitted.bounds);
    assert.equal(placements.at(-1).y, fitted.y + 40, 'The move is the newest placement');
    assert.ok(moveResult.ok || moveResult.reason === 'pixels-unstable', `Move during hold: ${JSON.stringify(moveResult)}`);
    steps.move = { result: moveResult.ok ? 'accepted' : moveResult.reason, after: await atFrame('After a move during the hold') };

    // 3. A held screenshot that times out is restored at once and again when Chromium completes it late.
    const lateBefore = await lateRestores(), timeoutBlobs = await d.blobWrites();
    const timeout = await paused('first-capture', () => d.delay(6500));
    assert.deepEqual(await timeout.pending, { ok: false, kind: 'unavailable', reason: 'capture-timeout' });
    await d.until(async () => await lateRestores() > lateBefore, 'late restore after the timed-out screenshot');
    assert.equal(await d.blobWrites(), timeoutBlobs, 'A timed-out capture writes nothing');
    steps.timeout = { after: await atFrame('After a held screenshot timed out') };
    assert.equal((await d.capture()).ok, true, 'Capture works again after the timeout');

    // 4. Navigation completed during the hold (as Q-PV5): the new document's widget is created at the held size
    // inside the unchanged view, and is frame-sized again once the refused capture restores it.
    const navigation = await paused('first-capture', async () => { await d.navigate(); return { view: (await d.view()).bounds, widget: await d.widget() }; });
    assert.deepEqual(navigation.during.view, placements.at(-1), 'Navigation during the hold leaves the view at the frame');
    assert.deepEqual(await navigation.pending, { ok: false, kind: 'stale', reason: 'navigation' });
    await d.settle();
    steps.navigation = { during: navigation.during, after: await atFrame('After navigation during the hold') };
    assert.equal((await d.capture()).ok, true, 'Capture works on the new document');

    // 5. Settings hides the view mid-capture; once it closes the view is visible at the frame and frame-sized.
    // A screenshot of the hidden view may stall until it is shown again; its late completion is then restored.
    const settingsLate = await lateRestores();
    const settings = await paused('first-capture', async () => { await d.settings(true); return (await d.view()).visible; });
    assert.equal(settings.during, false, 'Settings hides the view during the hold');
    const hidden = await settings.pending;
    await d.settings(false);
    await d.until(async () => (await d.view()).visible, 'view visible after Settings');
    const late = hidden.ok ? null : await observe(async () => await lateRestores() > settingsLate, 3000);
    steps.settings = { result: hidden.ok ? 'accepted' : hidden.reason, lateRestoreObserved: late, after: await atFrame('After Settings during the hold') };
  } finally { trace = await d.traceStop(); }
  const frames = placements.map(p => ({ x: p.x * factor, y: p.y * factor, ...pixels(p) }));
  const layers = heldWidgetClipped(compositorLayers(trace, await d.browserPid()), { shot: pixels(shot), content: pixels(content), placements: frames });
  return { shot, factor, placements, steps, layers };
}
