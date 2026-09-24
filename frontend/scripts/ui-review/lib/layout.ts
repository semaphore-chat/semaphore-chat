/**
 * Before/after composite layout + the HTML page Chromium screenshots into the
 * composite image (Chromium, not sharp, draws it: the frontend image has no
 * fonts for labels, the Playwright image does). Pure.
 *
 * Layout per story × viewport, at most `maxWidth` (1600) px wide:
 *   title bar (story id, viewport, % changed)
 *   [before | after | diff]   — diff panel only when three fit at 1:1 (phone)
 *   zoom row: before | after crops of the changed region at 1:1, when the
 *             panels above had to be scaled down and the change is small
 * Changed regions are outlined on every panel. Very tall full-page shots are
 * cropped to a window centred on the change. `unstable` shots (see
 * classify.ts) are laid out like changes, with their own badge.
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
  maxWidth?: number;
  /** Max displayed height of the main panels. */
  maxPanelHeight?: number;
  gutter?: number;
  pad?: number;
}

export interface PanelSpec {
  kind: 'before' | 'after' | 'diff';
  image: ImageRef;
  label: string;
}

export interface CompositeLayout {
  width: number;
  scale: number;
  panelWidth: number;
  panelHeight: number;
  crop: { top: number; height: number };
  panels: PanelSpec[];
  zoom: { region: Box; scale: number } | null;
}

const DEFAULTS = { maxWidth: 1600, maxPanelHeight: 1500, gutter: 12, pad: 14 };

export function compositeLayout(input: CompositeInput, options: LayoutOptions = {}): CompositeLayout {
  const { maxWidth, maxPanelHeight, gutter, pad } = { ...DEFAULTS, ...options };
  const panels: PanelSpec[] = [];
  if (input.before && input.status !== 'new') panels.push({ kind: 'before', image: input.before, label: input.labels.before });
  if (input.after && input.status !== 'removed') panels.push({ kind: 'after', image: input.after, label: input.labels.after });

  const pageWidth = Math.max(...panels.map((p) => p.image.width), 1);
  const pageHeight = Math.max(...panels.map((p) => p.image.height), 1);
  const inner = maxWidth - 2 * pad;
  const isDiff = input.status === 'changed' || input.status === 'unstable';
  if (isDiff && input.diff && 3 * pageWidth + 2 * gutter <= inner) {
    panels.push({ kind: 'diff', image: input.diff, label: 'diff' });
  }

  const n = Math.max(panels.length, 1);
  const scale = Math.min(1, (inner - (n - 1) * gutter) / (n * pageWidth));
  const crop = cropWindow(pageHeight, input.boxes, Math.floor(maxPanelHeight / scale));
  const panelWidth = Math.round(pageWidth * scale);
  const panelHeight = Math.round(crop.height * scale);

  let zoom: CompositeLayout['zoom'] = null;
  const union = unionBox(input.boxes);
  if (isDiff && union && scale < 0.9) {
    const margin = 24;
    const minWidth = Math.min(pageWidth, 320);
    let x = Math.max(0, union.x - margin);
    let right = Math.min(pageWidth, union.x + union.width + margin);
    if (right - x < minWidth) {
      const grow = minWidth - (right - x);
      x = Math.max(0, x - Math.ceil(grow / 2));
      right = Math.min(pageWidth, x + minWidth);
      x = Math.max(0, right - minWidth);
    }
    const y = Math.max(0, union.y - margin);
    const bottom = Math.min(pageHeight, union.y + union.height + margin);
    const region = { x, y, width: right - x, height: bottom - y };
    const zoomScale = Math.min(1, (inner - gutter) / (2 * region.width));
    // Only worth it when the zoom shows the change noticeably bigger than the panels do.
    const small = region.width <= pageWidth * 0.6 && region.height <= 700;
    if (small && zoomScale > scale * 1.3) zoom = { region, scale: Math.round(zoomScale * 1000) / 1000 };
  }

  const width = Math.round(2 * pad + n * panelWidth + (n - 1) * gutter);
  return { width, scale: Math.round(scale * 1000) / 1000, panelWidth, panelHeight, crop, panels, zoom };
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STATUS_COLOR: Record<CompositeInput['status'], string> = { changed: '#d29922', unstable: '#a371f7', new: '#3fb950', removed: '#f85149' };

function boxesHtml(boxes: Box[], scale: number, offsetX: number, offsetY: number): string {
  return boxes
    .map(
      (b) =>
        `<div class="box" style="left:${Math.round((b.x - offsetX) * scale) - 2}px;top:${Math.round((b.y - offsetY) * scale) - 2}px;width:${Math.round(b.width * scale) + 4}px;height:${Math.round(b.height * scale) + 4}px"></div>`,
    )
    .join('');
}

export function compositeHtml(input: CompositeInput, options: LayoutOptions = {}): string {
  const { gutter, pad } = { ...DEFAULTS, ...options };
  const layout = compositeLayout(input, options);
  const { scale, crop, panelWidth, panelHeight } = layout;

  const panelHtml = layout.panels
    .map((p) => {
      const outline = p.kind === 'diff' ? '' : boxesHtml(input.boxes, scale, 0, crop.top);
      return (
        `<figure><figcaption class="${p.kind}">${esc(p.label)}</figcaption>` +
        `<div class="frame" style="width:${panelWidth}px;height:${panelHeight}px">` +
        `<img src="${esc(p.image.src)}" style="width:${Math.round(p.image.width * scale)}px;top:${-Math.round(crop.top * scale)}px">` +
        `${outline}</div></figure>`
      );
    })
    .join('');

  let zoomHtml = '';
  if (layout.zoom) {
    const { region, scale: z } = layout.zoom;
    const zoomPanels = layout.panels.filter((p) => p.kind !== 'diff');
    zoomHtml =
      `<div class="caption">zoom on the change (${Math.round(z * 100)}%)</div><div class="row">` +
      zoomPanels
        .map(
          (p) =>
            `<figure><figcaption class="${p.kind}">${esc(p.label)}</figcaption>` +
            `<div class="frame" style="width:${Math.round(region.width * z)}px;height:${Math.round(region.height * z)}px">` +
            `<img src="${esc(p.image.src)}" style="width:${Math.round(p.image.width * z)}px;left:${-Math.round(region.x * z)}px;top:${-Math.round(region.y * z)}px">` +
            `${boxesHtml(input.boxes, z, region.x, region.y)}</div></figure>`,
        )
        .join('') +
      '</div>';
  }

  const size = input.after ?? input.before;
  const meta = [
    `${esc(input.viewport)}${size ? ` ${size.width}×${size.height}` : ''}`,
    (input.status === 'changed' || input.status === 'unstable') && input.diffPercent !== undefined ? `${input.diffPercent < 0.01 ? '<0.01' : input.diffPercent.toFixed(2)}% of pixels changed` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; }
body { margin: 0; background: #0d1117; }
#composite { display: inline-block; padding: ${pad}px; background: #0d1117; color: #e6edf3;
  font: 14px/1.35 "Liberation Sans", "DejaVu Sans", Arial, sans-serif; }
.title { display: flex; gap: 10px; align-items: baseline; margin-bottom: 10px; white-space: nowrap; }
.title b { font-size: 16px; }
.badge { font-size: 12px; font-weight: 700; padding: 1px 7px; border-radius: 10px; color: #0d1117; background: ${STATUS_COLOR[input.status]}; }
.meta { color: #8b949e; }
.row { display: flex; gap: ${gutter}px; align-items: flex-start; }
figure { margin: 0; }
figcaption { font-size: 13px; font-weight: 700; margin-bottom: 4px; color: #8b949e; }
figcaption.before { color: #ff7b72; } figcaption.after { color: #7ee787; }
.frame { position: relative; overflow: hidden; background: #161b22; outline: 1px solid #30363d; }
.frame img { position: absolute; left: 0; top: 0; max-width: none; }
.box { position: absolute; border: 2px solid #ff2d55; border-radius: 3px; box-shadow: 0 0 0 1px rgba(0,0,0,.6); }
.caption { margin: 12px 0 6px; color: #8b949e; font-size: 12px; }
</style></head><body><div id="composite">
<div class="title"><b>${esc(input.storyId)}</b><span class="badge">${input.status}</span><span class="meta">${meta}</span></div>
<div class="row">${panelHtml}</div>${zoomHtml}
</div></body></html>`;
}
