/**
 * Animated GIFs for the marketing showcase (`showcase.ts`): the GIF picker's
 * search results and the GIF messages in Couch Co-op.
 *
 * Nothing here comes from a real GIF provider. Every GIF is drawn frame by
 * frame on a canvas (flat, cartoon art in the style of `showcaseArt.ts`),
 * quantised to a 256-colour palette and encoded as a real GIF89a, in the
 * browser, deterministically. `showcaseGifHandlers()` then answers the app's
 * GIF endpoints (`/api/gifs/search`, `/api/gifs/featured` — what the backend
 * proxies to its provider) and serves the files from a fictional media host,
 * so the app's real paths run unchanged: the picker grid, `sendMessageContent(gif.url)`,
 * and `GifEmbed` for a message that is just a `.gif` URL.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { GifResultDto } from '../../api-client/types.gen';

/** The fictional GIF media host (`.example` is reserved, so it can never resolve). */
export const SHOWCASE_GIF_HOST = 'https://media.gifs.example';

// Art is drawn on a 480×360 canvas and encoded at SCALE (small, like a real
// reaction GIF, so a GIF message doesn't take over the channel).
const W = 480;
const H = 360;
const SCALE = 0.5;
const OUT_W = W * SCALE;
const OUT_H = H * SCALE;

type Ctx = OffscreenCanvasRenderingContext2D;

interface GifSpec {
  id: string;
  title: string;
  tags: string[];
  frames: number;
  /** Delay per frame, in hundredths of a second. */
  delay: (frame: number) => number;
  draw: (ctx: Ctx, frame: number) => void;
}

export const showcaseGifUrl = (id: string): string => `${SHOWCASE_GIF_HOST}/${id}.gif`;

// ─────────────────────────────────────────────────────────────────────────
// Drawing helpers
// ─────────────────────────────────────────────────────────────────────────

const INK = '#15131F';

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = stroke;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}

function circle(ctx: Ctx, x: number, y: number, r: number, fill: string, stroke?: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = stroke;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}

function line(ctx: Ctx, pts: [number, number][], color: string, width: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function fill(ctx: Ctx, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
}

/** A four-point sparkle. */
function sparkle(ctx: Ctx, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Cave backdrop: dark rock with a few glowing crystals. */
function cave(ctx: Ctx) {
  fill(ctx, '#1B1530');
  ctx.fillStyle = '#231B3E';
  for (const [x, y, r] of [[70, 60, 70], [260, 20, 90], [420, 90, 80], [160, 150, 50]] as const) {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [x, y, s] of [[40, 120, 9], [120, 40, 6], [300, 70, 8], [455, 40, 7], [380, 150, 5]] as const) {
    ctx.beginPath();
    ctx.moveTo(x, y - s * 1.6);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s * 1.6);
    ctx.lineTo(x - s, y);
    ctx.closePath();
    ctx.fillStyle = '#5EEAD4';
    ctx.fill();
  }
}

interface MinerPose {
  suit?: string;
  eyes?: 'open' | 'closed' | 'dizzy' | 'wide';
  /** Right-arm angle in radians (0 = hanging down, -2.6 ≈ raised). */
  arm?: number;
  /** Leg swing, -1..1. */
  step?: number;
  /** Vertical squash (1 = none). */
  squash?: number;
}

/** A little Deep Rift driller: helmet with a lamp, overalls. (x, y) = between the feet; s = scale. */
function miner(ctx: Ctx, x: number, y: number, s: number, pose: MinerPose = {}) {
  const suit = pose.suit ?? '#FF8A3D';
  const step = pose.step ?? 0;
  const sq = pose.squash ?? 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s * sq);
  const lw = 3.2;
  // Legs.
  rr(ctx, -15 + step * 4, -24, 12, 24, 5, '#2D2446', lw);
  rr(ctx, 3 - step * 4, -24, 12, 24, 5, '#2D2446', lw);
  // Left arm (hanging).
  rr(ctx, -31, -58, 11, 30, 5, suit, lw);
  // Body.
  rr(ctx, -23, -64, 46, 44, 12, suit, lw);
  ctx.fillStyle = '#2D2446';
  ctx.fillRect(-21.5, -36, 43, 6);
  // Right arm (rotates from the shoulder).
  ctx.save();
  ctx.translate(25, -56);
  ctx.rotate(pose.arm ?? 0);
  rr(ctx, -5.5, -2, 11, 30, 5, suit, lw);
  circle(ctx, 0, 30, 7, '#F2C9A0', lw);
  ctx.restore();
  // Head.
  circle(ctx, 0, -84, 21, '#F2C9A0', lw);
  // Helmet + lamp.
  ctx.beginPath();
  ctx.arc(0, -88, 24, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#FFD35C';
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
  rr(ctx, -28, -90, 56, 7, 3, '#FFD35C', lw);
  circle(ctx, 0, -101, 6.5, '#FFF6C9', lw);
  // Eyes.
  const eyes = pose.eyes ?? 'open';
  if (eyes === 'open') {
    circle(ctx, -8, -78, 2.8, INK);
    circle(ctx, 8, -78, 2.8, INK);
  } else if (eyes === 'wide') {
    circle(ctx, -8, -78, 4.5, '#FFFFFF', 2);
    circle(ctx, 8, -78, 4.5, '#FFFFFF', 2);
    circle(ctx, -8, -78, 1.8, INK);
    circle(ctx, 8, -78, 1.8, INK);
  } else if (eyes === 'closed') {
    line(ctx, [[-12, -77], [-8, -80], [-4, -77]], INK, 2.4);
    line(ctx, [[4, -77], [8, -80], [12, -77]], INK, 2.4);
  } else {
    for (const cx of [-8, 8]) {
      line(ctx, [[cx - 4, -82], [cx + 4, -74]], INK, 2.4);
      line(ctx, [[cx + 4, -82], [cx - 4, -74]], INK, 2.4);
    }
  }
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────
// The GIFs
// ─────────────────────────────────────────────────────────────────────────

/** A driller walks off a ledge into a pit, lands, sees stars (kwam3's GIF in #general). */
const pitFall: GifSpec = {
  id: 'deep-rift-pit-fall',
  title: 'fell in the pit',
  tags: ['pit', 'fall', 'fail', 'oops', 'cave'],
  frames: 30,
  delay: (f) => (f < 9 ? 8 : f < 15 ? 5 : f === 29 ? 90 : 9),
  draw(ctx, f) {
    cave(ctx);
    // Ledges either side of the pit (top at L), and its floor (F).
    const L = 150;
    const F = 318;
    const [p0, p1] = [170, 330];
    const rock = '#3B2F5C';
    const edge = '#54457F';
    ctx.fillStyle = rock;
    ctx.fillRect(0, L, p0, H - L);
    ctx.fillRect(p1, L, W - p1, H - L);
    ctx.fillStyle = '#2A2145';
    ctx.fillRect(p0, L, p1 - p0, H - L);
    ctx.fillStyle = rock;
    ctx.fillRect(p0, F, p1 - p0, H - F);
    ctx.fillStyle = edge;
    ctx.fillRect(0, L, p0, 6);
    ctx.fillRect(p1, L, W - p1, 6);
    ctx.fillRect(p0, F, p1 - p0, 5);
    const s = 0.9;
    const land = 250;
    if (f < 9) {
      // Walking right along the ledge.
      miner(ctx, 36 + f * 16, L, s, { step: f % 2 ? 1 : -1 });
    } else if (f < 15) {
      // Falling (eyes wide).
      const t = (f - 8) / 6;
      miner(ctx, 170 + t * (land - 170), L + t * t * (F - L), s, { eyes: 'wide', arm: -2.4, step: 0 });
    } else if (f < 17) {
      // Landing: squash + dust.
      miner(ctx, land, F, s, { squash: f === 15 ? 0.78 : 0.9, eyes: 'closed' });
      for (const [dx, r] of [[-44, 13], [-26, 10], [34, 12], [50, 9]] as const) circle(ctx, land + dx, F - 6, r + (f - 15) * 3, '#8C7FB3');
    } else {
      // Dizzy, with stars circling.
      miner(ctx, land, F, s, { eyes: 'dizzy' });
      for (let k = 0; k < 3; k++) {
        const a = (f - 17) * 0.55 + (k * Math.PI * 2) / 3;
        sparkle(ctx, land + Math.cos(a) * 38, F - 106 + Math.sin(a) * 10, 11, '#FFD35C');
      }
    }
  },
};

/** "ok" in big rounded letters, gently popping. */
const okText: GifSpec = {
  id: 'ok-pop',
  title: 'ok',
  tags: ['ok', 'okay', 'k', 'sure'],
  frames: 12,
  delay: () => 7,
  draw(ctx, f) {
    fill(ctx, '#12B886');
    const scale = 1 + 0.07 * Math.sin((f / 12) * Math.PI * 2);
    const rot = 0.05 * Math.sin((f / 12) * Math.PI * 2 + 1);
    for (const [dx, dy, color] of [[7, 9, '#0B7285'], [0, 0, '#FFFFFF']] as const) {
      ctx.save();
      ctx.translate(W / 2 + dx, H / 2 + dy);
      ctx.rotate(rot);
      ctx.scale(scale, scale);
      ctx.beginPath();
      ctx.arc(-62, 12, 50, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 30;
      ctx.stroke();
      line(ctx, [[42, -92], [42, 62]], color, 30);
      line(ctx, [[112, -30], [48, 20], [112, 62]], color, 30);
      ctx.restore();
    }
  },
};

/** A thumbs-up bouncing. */
const thumbsUp: GifSpec = {
  id: 'thumbs-up-bounce',
  title: 'thumbs up',
  tags: ['ok', 'yes', 'thumbs', 'good', 'sure'],
  frames: 12,
  delay: () => 6,
  draw(ctx, f) {
    fill(ctx, '#3A2E6E');
    const t = f / 12;
    const bounce = -Math.abs(Math.sin(t * Math.PI * 2)) * 26;
    ctx.save();
    ctx.translate(W / 2 + 10, H / 2 + 40 + bounce);
    ctx.rotate(-0.08 + 0.06 * Math.sin(t * Math.PI * 4));
    ctx.scale(1.25, 1.25);
    const skin = '#FFC94D';
    rr(ctx, -46, -118, 38, 104, 19, skin, 5); // thumb
    rr(ctx, -50, -30, 104, 84, 24, skin, 5); // fist
    for (const y of [-6, 14, 34]) line(ctx, [[20, y], [50, y]], '#C98A1A', 4);
    rr(ctx, -84, -34, 34, 92, 8, '#7C5CFF', 5); // sleeve
    ctx.restore();
    for (const [x, y, r, k] of [[110, 80, 13, 0], [372, 96, 10, 1], [392, 262, 12, 2], [96, 250, 9, 3]] as const) {
      const on = (f + k * 3) % 12 < 7;
      if (on) sparkle(ctx, x, y, r, '#FFD35C');
    }
  },
};

/** A green check mark drawn into a circle. */
const check: GifSpec = {
  id: 'check-done',
  title: 'done',
  tags: ['ok', 'done', 'check', 'yes'],
  frames: 16,
  delay: (f) => (f === 15 ? 80 : 6),
  draw(ctx, f) {
    fill(ctx, '#1E1B33');
    const pop = f < 3 ? [0.4, 0.8, 1.08][f] : f === 3 ? 1 : 1;
    circle(ctx, W / 2, H / 2, 108 * pop, '#3DD68C');
    const p = Math.max(0, Math.min(1, (f - 4) / 6));
    if (p > 0) {
      const pts: [number, number][] = [[W / 2 - 52, H / 2 + 2], [W / 2 - 14, H / 2 + 40], [W / 2 + 58, H / 2 - 42]];
      const seg1 = Math.hypot(38, 38);
      const seg2 = Math.hypot(72, 82);
      const len = (seg1 + seg2) * p;
      const path: [number, number][] = [pts[0]];
      if (len <= seg1) {
        path.push([pts[0][0] + 38 * (len / seg1), pts[0][1] + 38 * (len / seg1)]);
      } else {
        const r = (len - seg1) / seg2;
        path.push(pts[1], [pts[1][0] + 72 * r, pts[1][1] - 82 * r]);
      }
      line(ctx, path, '#FFFFFF', 26);
    }
  },
};

/** A round face nodding. */
const nod: GifSpec = {
  id: 'nod-yes',
  title: 'nod',
  tags: ['ok', 'yes', 'nod', 'agree'],
  frames: 10,
  delay: () => 7,
  draw(ctx, f) {
    fill(ctx, '#FF8A3D');
    const t = f / 10;
    const dy = 20 * Math.sin(t * Math.PI * 2);
    const cx = W / 2;
    const cy = H / 2 + 16 + dy;
    circle(ctx, cx, cy, 112, '#FFE8C2', 6);
    const down = dy > 6;
    if (down) {
      line(ctx, [[cx - 54, cy - 8], [cx - 38, cy - 20], [cx - 22, cy - 8]], INK, 8);
      line(ctx, [[cx + 22, cy - 8], [cx + 38, cy - 20], [cx + 54, cy - 8]], INK, 8);
    } else {
      circle(ctx, cx - 38, cy - 14, 10, INK);
      circle(ctx, cx + 38, cy - 14, 10, INK);
    }
    circle(ctx, cx - 64, cy + 22, 14, '#FF9F7A');
    circle(ctx, cx + 64, cy + 22, 14, '#FF9F7A');
    ctx.beginPath();
    ctx.arc(cx, cy + 18, 34, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();
  },
};

/** A speech bubble that just says "k". */
const kBubble: GifSpec = {
  id: 'k-bubble',
  title: 'k',
  tags: ['ok', 'k', 'fine'],
  frames: 14,
  delay: (f) => (f === 13 ? 60 : 6),
  draw(ctx, f) {
    fill(ctx, '#E0306F');
    const s = f < 4 ? [0.3, 0.75, 1.1, 0.96][f] : 1 + 0.02 * Math.sin(f);
    ctx.save();
    ctx.translate(W / 2, H / 2 - 6);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.roundRect(-120, -84, 240, 158, 44);
    ctx.moveTo(-50, 70);
    ctx.lineTo(-86, 118);
    ctx.lineTo(-10, 72);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    line(ctx, [[-22, -46], [-22, 42]], '#2D2446', 22);
    line(ctx, [[30, -12], [-16, 10], [32, 42]], '#2D2446', 22);
    ctx.restore();
  },
};

/** A driller waving, lamp flickering. */
const minerWave: GifSpec = {
  id: 'deep-rift-wave',
  title: 'on my way',
  tags: ['ok', 'hi', 'wave', 'cave', 'omw'],
  frames: 12,
  delay: () => 8,
  draw(ctx, f) {
    cave(ctx);
    ctx.fillStyle = '#3B2F5C';
    ctx.fillRect(0, 300, W, 60);
    ctx.fillStyle = '#54457F';
    ctx.fillRect(0, 300, W, 6);
    const arm = -2.5 + 0.45 * Math.sin((f / 12) * Math.PI * 2);
    miner(ctx, W / 2, 300, 2.1, { arm, eyes: f % 12 === 7 ? 'closed' : 'open' });
  },
};

const GIFS: GifSpec[] = [okText, thumbsUp, check, nod, kBubble, minerWave, pitFall];
/** The picker's "trending" grid before anything is typed. */
const FEATURED = [thumbsUp, pitFall, minerWave, nod, okText, check, kBubble];

// ─────────────────────────────────────────────────────────────────────────
// GIF89a encoder (global 256-colour palette, LZW)
// ─────────────────────────────────────────────────────────────────────────

function renderFrames(spec: GifSpec): Uint8ClampedArray[] {
  const canvas = new OffscreenCanvas(OUT_W, OUT_H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const frames: Uint8ClampedArray[] = [];
  for (let f = 0; f < spec.frames; f++) {
    ctx.save();
    ctx.clearRect(0, 0, OUT_W, OUT_H);
    ctx.scale(SCALE, SCALE);
    spec.draw(ctx, f);
    ctx.restore();
    frames.push(ctx.getImageData(0, 0, OUT_W, OUT_H).data);
  }
  return frames;
}

/** Popularity palette over 5-bit-per-channel bins; nearest-colour mapping (deterministic). */
function quantise(frames: Uint8ClampedArray[]): { palette: number[]; indexed: Uint8Array[] } {
  const bins = new Map<number, [number, number, number, number]>();
  for (const px of frames) {
    for (let i = 0; i < px.length; i += 4) {
      const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
      const b = bins.get(key);
      if (b) {
        b[0] += 1;
        b[1] += px[i];
        b[2] += px[i + 1];
        b[3] += px[i + 2];
      } else bins.set(key, [1, px[i], px[i + 1], px[i + 2]]);
    }
  }
  const top = Array.from(bins.entries())
    .sort((a, b) => b[1][0] - a[1][0] || a[0] - b[0])
    .slice(0, 256)
    .map(([, [n, r, g, b]]) => [Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
  while (top.length < 256) top.push([0, 0, 0]);
  const cache = new Map<number, number>();
  const nearest = (r: number, g: number, b: number) => {
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < top.length; i++) {
      const [pr, pg, pb] = top[i];
      const d = (pr - r) * (pr - r) * 2 + (pg - g) * (pg - g) * 3 + (pb - b) * (pb - b);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cache.set(key, best);
    return best;
  };
  const indexed = frames.map((px) => {
    const out = new Uint8Array(px.length / 4);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) out[j] = nearest(px[i], px[i + 1], px[i + 2]);
    return out;
  });
  return { palette: top.flat(), indexed };
}

class ByteWriter {
  bytes: number[] = [];
  u8(...v: number[]) {
    for (const b of v) this.bytes.push(b & 0xff);
  }
  u16(v: number) {
    this.u8(v & 0xff, (v >> 8) & 0xff);
  }
  str(s: string) {
    for (const ch of s) this.u8(ch.charCodeAt(0));
  }
}

/** LZW-compress one frame's indices (min code size 8), as GIF data sub-blocks. */
function lzw(out: ByteWriter, pixels: Uint8Array) {
  const minCodeSize = 8;
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map<number, number>();
  const data: number[] = [];
  let cur = 0;
  let shift = 0;
  const emit = (code: number) => {
    cur |= code << shift;
    shift += codeSize;
    while (shift >= 8) {
      data.push(cur & 0xff);
      cur >>>= 8;
      shift -= 8;
    }
  };
  emit(clear);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      codeSize = minCodeSize + 1;
    } else {
      if (next >= 1 << codeSize) codeSize += 1;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (shift > 0) data.push(cur & 0xff);
  out.u8(minCodeSize);
  for (let i = 0; i < data.length; i += 255) {
    const block = data.slice(i, i + 255);
    out.u8(block.length, ...block);
  }
  out.u8(0);
}

function encodeGif(spec: GifSpec): Uint8Array {
  const { palette, indexed } = quantise(renderFrames(spec));
  const out = new ByteWriter();
  out.str('GIF89a');
  out.u16(OUT_W);
  out.u16(OUT_H);
  out.u8(0xf7, 0, 0); // global colour table, 256 entries
  out.u8(...palette);
  out.u8(0x21, 0xff, 0x0b);
  out.str('NETSCAPE2.0');
  out.u8(0x03, 0x01, 0x00, 0x00, 0x00); // loop forever
  indexed.forEach((pixels, f) => {
    out.u8(0x21, 0xf9, 0x04, 0x04); // graphic control: disposal "leave in place", no transparency
    out.u16(spec.delay(f));
    out.u8(0x00, 0x00);
    out.u8(0x2c);
    out.u16(0);
    out.u16(0);
    out.u16(OUT_W);
    out.u16(OUT_H);
    out.u8(0x00);
    lzw(out, pixels);
  });
  out.u8(0x3b);
  return new Uint8Array(out.bytes);
}

const encoded = new Map<string, Uint8Array>();
function gifBytes(spec: GifSpec): Uint8Array {
  let bytes = encoded.get(spec.id);
  if (!bytes) {
    bytes = encodeGif(spec);
    encoded.set(spec.id, bytes);
  }
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────────
// Provider endpoints + media host
// ─────────────────────────────────────────────────────────────────────────

const toResult = (g: GifSpec): GifResultDto => ({
  id: g.id,
  title: g.title,
  url: showcaseGifUrl(g.id),
  previewUrl: showcaseGifUrl(g.id),
  width: OUT_W,
  height: OUT_H,
});

/** Ids of the GIFs, for messages that post one (`showcaseGifUrl(SHOWCASE_GIFS.pitFall)`). */
export const SHOWCASE_GIFS = { pitFall: pitFall.id, ok: okText.id, thumbsUp: thumbsUp.id, nod: nod.id } as const;

/** `/api/gifs/*` (the backend's provider proxy) and the GIF files themselves. */
export function showcaseGifHandlers(): HttpHandler[] {
  return [
    http.get('/api/gifs/featured', () => HttpResponse.json({ results: FEATURED.map(toResult) })),
    http.get('/api/gifs/search', ({ request }) => {
      const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase();
      const hits = GIFS.filter((g) => g.tags.some((t) => t.startsWith(q)) || g.title.includes(q));
      return HttpResponse.json({ results: (hits.length ? hits : FEATURED).map(toResult) });
    }),
    http.get(`${SHOWCASE_GIF_HOST}/:file`, ({ params }) => {
      const spec = GIFS.find((g) => `${g.id}.gif` === String(params.file));
      if (!spec) return new HttpResponse(null, { status: 404 });
      return new HttpResponse(gifBytes(spec), {
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
      });
    }),
  ];
}
