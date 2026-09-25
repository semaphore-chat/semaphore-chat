/**
 * Before/after composite layout + the HTML page Chromium screenshots into the
 * composite image (Chromium, not sharp, draws it: the frontend image has no
 * fonts for labels, the Playwright image does). Pure.
 *
 * Composites are read in a PR description, where GitHub shows an image at
 * most about 880 px wide, so a composite is at most `maxWidth` (860) px wide
 * and the changed area is shown at (close to) 1:1:
 *
 *   title bar (story id, status, viewport, % changed)
 *   changed regions — each changed area cropped with some context, at 1:1:
 *     [before | after | diff] side by side when the three fit, else
 *     [before | after], else before above after (scaled down if wider)
 *   full view — the whole page for orientation, changed regions outlined:
 *     [before | after] side by side (a phone fits at 1:1); or, when a change
 *     covers too much of a tablet/desktop page to crop, before above after
 *     at the full composite width
 *
 * At most `maxFocus` (3) regions are cropped, the biggest; the others are
 * only outlined in the full view (the composite says so). Very tall
 * full-page shots are cropped to a window centred on the change. `unstable`
 * shots (see classify.ts) are laid out like changes, with their own badge;
 * new/removed stories get their one side, as large as fits.
 */
import { cropWindow, unionBox, type Box } from './classify.ts';

export interface ImageRef {
  src: string;
  width: number;
  height: number;
}

export interface CompositeInput {
  storyId: string;
  viewport: string;
  status: 'changed' | 'unstable' | 'new' | 'removed';
  before?: ImageRef;
  after?: ImageRef;
  diff?: ImageRef;
  boxes: Box[];
  labels: { before: string; after: string };
  diffPercent?: number;
}

export interface LayoutOptions {
  /** Composite width cap (px): about what GitHub shows of an image in a PR description. */
  maxWidth?: number;
  /** Max displayed height of a full-view panel. */
  maxPanelHeight?: number;
  /** Max displayed height of one changed-region crop. */
  maxFocusHeight?: number;
  /** Changed regions cropped at most; the others are only outlined in the full view. */
  maxFocus?: number;
  gutter?: number;
  pad?: number;
}

export interface PanelSpec {
  kind: 'before' | 'after' | 'diff';
  image: ImageRef;
  label: string;
}

/** One changed region, cropped out of each panel. */
export interface FocusSpec {
  /** Page px. */
  region: Box;
  scale: number;
  direction: 'row' | 'column';
  panels: PanelSpec[];
}

export interface CompositeLayout {
  width: number;
  focus: FocusSpec[];
  /** Merged changed regions (page px): the biggest are cropped (`focus`), all are outlined in the full view. */
  regions: Box[];
  full: {
    scale: number;
    direction: 'row' | 'column';
    panelWidth: number;
    panelHeight: number;
    crop: { top: number; height: number };
    panels: PanelSpec[];
  };
}

/** Composite width cap: GitHub shows PR-description images up to about 880 px wide. */
export const COMPOSITE_MAX_WIDTH = 860;

const DEFAULTS = { maxWidth: COMPOSITE_MAX_WIDTH, maxPanelHeight: 1400, maxFocusHeight: 520, maxFocus: 3, gutter: 12, pad: 12 };

/** Context kept around a changed area (px, each side). */
const FOCUS_MARGIN = 24;
/** A crop is at least this big (when the page is), so a tiny change keeps its surroundings; three 260 px crops (before, after, diff) fit side by side. */
const FOCUS_MIN = { width: 260, height: 96 };
/** Changed areas closer than this (px) share one crop. */
const FOCUS_JOIN = 32;
/** Below this scale a crop is no easier to read than the full view: the change is too big to crop. */
const FOCUS_MIN_SCALE = 0.75;
/** A full view side by side at this scale or more is legible as it is: no crops needed. */
const LEGIBLE_SCALE = 0.95;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** `b` grown by `margin` and to at least `FOCUS_MIN` (centred), clamped to the page. */
function grow(b: Box, margin: number, pageWidth: number, pageHeight: number): Box {
  const span = (start: number, end: number, min: number, max: number): [number, number] => {
    let s = Math.max(0, start - margin);
    let e = Math.min(max, end + margin);
    const want = Math.min(max, min);
    if (e - s < want) {
      s = Math.max(0, Math.round((s + e - want) / 2));
      e = Math.min(max, s + want);
      s = e - want;
    }
    return [s, e];
  };
  const [x, right] = span(b.x, b.x + b.width, FOCUS_MIN.width, pageWidth);
  const [y, bottom] = span(b.y, b.y + b.height, FOCUS_MIN.height, pageHeight);
  return { x, y, width: right - x, height: bottom - y };
}

const near = (a: Box, b: Box, gap: number) =>
  a.x <= b.x + b.width + gap && b.x <= a.x + a.width + gap && a.y <= b.y + b.height + gap && b.y <= a.y + a.height + gap;

/**
 * Changed areas → regions to crop: each diff box grown by `FOCUS_MARGIN` (and
 * to at least `FOCUS_MIN`), clamped to the page; regions that overlap or
 * nearly touch are merged until none do. Sorted top to bottom.
 */
export function focusRegions(boxes: Box[], pageWidth: number, pageHeight: number): Box[] {
  const regions = boxes.map((b) => grow(b, FOCUS_MARGIN, pageWidth, pageHeight));
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      if (near(regions[i], regions[j], FOCUS_JOIN)) {
        regions[i] = unionBox([regions[i], regions[j]])!;
        regions.splice(j, 1);
        j = i; // the grown region may now reach earlier ones
      }
    }
  }
  return regions.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function compositeLayout(input: CompositeInput, options: LayoutOptions = {}): CompositeLayout {
  const { maxWidth, maxPanelHeight, maxFocusHeight, maxFocus, gutter, pad } = { ...DEFAULTS, ...options };
  const sides: PanelSpec[] = [];
  if (input.before && input.status !== 'new') sides.push({ kind: 'before', image: input.before, label: input.labels.before });
  if (input.after && input.status !== 'removed') sides.push({ kind: 'after', image: input.after, label: input.labels.after });

  const pageWidth = Math.max(...sides.map((p) => p.image.width), 1);
  const pageHeight = Math.max(...sides.map((p) => p.image.height), 1);
  const inner = maxWidth - 2 * pad;
  const isDiff = (input.status === 'changed' || input.status === 'unstable') && sides.length === 2;
  const n = Math.max(sides.length, 1);
  const rowScale = Math.min(1, (inner - (n - 1) * gutter) / (n * pageWidth));
  const fullIsLegible = rowScale >= LEGIBLE_SCALE;

  // Changed regions, cropped at (up to) 1:1 — the biggest `maxFocus` of them.
  const regions = isDiff ? focusRegions(input.boxes, pageWidth, pageHeight) : [];
  const diffPanel: PanelSpec | null = isDiff && input.diff ? { kind: 'diff', image: input.diff, label: 'diff' } : null;
  const focus: FocusSpec[] = [];
  const biggestFirst = [...regions].sort((a, b) => b.width * b.height - a.width * a.height);
  for (const region of biggestFirst.slice(0, maxFocus)) {
    const w = region.width;
    let spec: FocusSpec;
    if (diffPanel && 3 * w + 2 * gutter <= inner) spec = { region, scale: 1, direction: 'row', panels: [...sides, diffPanel] };
    else if (2 * w + gutter <= inner) spec = { region, scale: 1, direction: 'row', panels: sides };
    else spec = { region, scale: Math.min(1, inner / w), direction: 'column', panels: sides };
    spec.scale = round3(Math.min(spec.scale, maxFocusHeight / region.height));
    if (spec.scale < FOCUS_MIN_SCALE) continue; // too big to crop legibly: the full view shows it
    // Side by side at 1:1 already (a phone): a crop only adds something with the diff panel.
    if (fullIsLegible && !spec.panels.includes(diffPanel!)) continue;
    focus.push(spec);
  }
  focus.sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x);

  // Full view: side by side; or — a change too big to crop on a page too wide
  // for that — before above after, at the full width.
  const stack = isDiff && focus.length === 0 && !fullIsLegible;
  const fullScale = stack ? Math.min(1, inner / pageWidth) : rowScale;
  const crop = cropWindow(pageHeight, regions.length ? regions : input.boxes, Math.floor(maxPanelHeight / fullScale));
  const panelWidth = Math.round(pageWidth * fullScale);
  const panelHeight = Math.round(crop.height * fullScale);

  const rowWidth = (count: number, w: number) => count * w + (count - 1) * gutter;
  const contentWidth = Math.max(
    stack ? panelWidth : rowWidth(n, panelWidth),
    ...focus.map((f) => {
      const w = Math.round(f.region.width * f.scale);
      return f.direction === 'row' ? rowWidth(f.panels.length, w) : w;
    }),
  );
  return {
    width: Math.round(2 * pad + contentWidth),
    focus,
    regions,
    full: { scale: round3(fullScale), direction: stack ? 'column' : 'row', panelWidth, panelHeight, crop, panels: sides },
  };
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STATUS_COLOR: Record<CompositeInput['status'], string> = { changed: '#d29922', unstable: '#a371f7', new: '#3fb950', removed: '#f85149' };

function boxesHtml(boxes: Box[], scale: number, offsetX: number, offsetY: number): string {
  return boxes
    .map(
      (b) =>
        `<div class="box" style="left:${Math.round((b.x - offsetX) * scale) - 3}px;top:${Math.round((b.y - offsetY) * scale) - 3}px;width:${Math.round(b.width * scale) + 6}px;height:${Math.round(b.height * scale) + 6}px"></div>`,
    )
    .join('');
}

/** One panel: `view` (page px) of the image at `scale`, with outlines. */
function panelHtml(p: PanelSpec, scale: number, view: Box, outlines: Box[]): string {
  return (
    `<figure><figcaption class="${p.kind}">${esc(p.label)}</figcaption>` +
    `<div class="frame" style="width:${Math.round(view.width * scale)}px;height:${Math.round(view.height * scale)}px">` +
    `<img src="${esc(p.image.src)}" style="width:${Math.round(p.image.width * scale)}px;left:${-Math.round(view.x * scale)}px;top:${-Math.round(view.y * scale)}px">` +
    `${p.kind === 'diff' ? '' : boxesHtml(outlines, scale, view.x, view.y)}</div></figure>`
  );
}

const pct = (scale: number) => `${Math.round(scale * 100)}%`;

export function compositeHtml(input: CompositeInput, options: LayoutOptions = {}): string {
  const { gutter, pad, maxWidth } = { ...DEFAULTS, ...options };
  const layout = compositeLayout(input, options);
  const { full, focus, regions } = layout;
  const isDiff = input.status === 'changed' || input.status === 'unstable';

  // The crops are the change itself: no outlines on them.
  const focusHtml = focus
    .map((f, i) => {
      const what = focus.length > 1 ? `Changed region ${i + 1} of ${focus.length}` : 'Changed region';
      return (
        `<div class="caption">${what} · ${pct(f.scale)}</div>` +
        `<div class="${f.direction}">${f.panels.map((p) => panelHtml(p, f.scale, f.region, [])).join('')}</div>`
      );
    })
    .join('');

  const hidden = regions.length - focus.length;
  const captionBits = [focus.length ? 'Full view' : isDiff ? 'Changed' : 'Screenshot', pct(full.scale)];
  if (focus.length && hidden > 0) captionBits.push(`${hidden} more changed region${hidden === 1 ? '' : 's'} outlined below`);
  const fullView: Box = { x: 0, y: full.crop.top, width: Math.round(full.panelWidth / full.scale), height: full.crop.height };
  // A region covering most of the page (a list that shifted) outlines nothing
  // useful, and its edges would just cut through the page.
  const pageArea = fullView.width * Math.max(1, ...full.panels.map((p) => p.image.height));
  const changedAreas = regions.length ? regions : input.boxes;
  const outlines = isDiff ? changedAreas.filter((b) => b.width * b.height <= 0.5 * pageArea) : [];
  if (isDiff && outlines.length < changedAreas.length) captionBits.push('most of the page changed');
  const fullHtml =
    `<div class="caption">${captionBits.join(' · ')}</div>` +
    `<div class="${full.direction}">${full.panels.map((p) => panelHtml(p, full.scale, fullView, outlines)).join('')}</div>`;

  const size = input.after ?? input.before;
  const meta = [
    `${esc(input.viewport)}${size ? ` ${size.width}×${size.height}` : ''}`,
    isDiff && input.diffPercent !== undefined ? `${input.diffPercent < 0.01 ? '<0.01' : input.diffPercent.toFixed(2)}% of pixels changed` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; }
body { margin: 0; background: #0d1117; }
#composite { display: inline-block; min-width: ${Math.min(layout.width, maxWidth)}px; max-width: ${maxWidth}px; padding: ${pad}px;
  background: #0d1117; color: #e6edf3; font: 16px/1.35 "Liberation Sans", "DejaVu Sans", Arial, sans-serif; }
.title { display: flex; flex-wrap: wrap; column-gap: 12px; row-gap: 4px; align-items: baseline; margin-bottom: 4px; }
.title b { font-size: 21px; overflow-wrap: anywhere; }
.badge { font-size: 15px; font-weight: 700; padding: 1px 9px; border-radius: 11px; color: #0d1117; background: ${STATUS_COLOR[input.status]}; }
.meta { color: #9da7b3; font-size: 16px; }
.row { display: flex; gap: ${gutter}px; align-items: flex-start; }
.column { display: flex; flex-direction: column; gap: ${gutter}px; align-items: flex-start; }
figure { margin: 0; }
figcaption { font-size: 15px; font-weight: 700; margin-bottom: 4px; color: #9da7b3; }
figcaption.before { color: #ff7b72; } figcaption.after { color: #7ee787; }
.frame { position: relative; overflow: hidden; background: #161b22; outline: 1px solid #30363d; }
.frame img { position: absolute; left: 0; top: 0; max-width: none; }
.box { position: absolute; border: 3px solid #ff2d55; border-radius: 4px; box-shadow: 0 0 0 1px rgba(0,0,0,.6); }
.caption { margin: 16px 0 6px; padding-top: 8px; border-top: 1px solid #30363d; color: #9da7b3; font-size: 14px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .05em; }
</style></head><body><div id="composite">
<div class="title"><b>${esc(input.storyId)}</b><span class="badge">${input.status}</span><span class="meta">${meta}</span></div>
${focusHtml}${fullHtml}
</div></body></html>`;
}
