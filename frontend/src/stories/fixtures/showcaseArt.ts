/**
 * Hand-drawn (in code) artwork for the marketing showcase scenario
 * (`showcase.ts`): illustrated person avatars, community logos, and the
 * images attached to showcase messages. Everything is plain SVG generated
 * locally and deterministically — no network, no licensed assets — and
 * served through the same `/api/file/:id` path the app's
 * `useAuthenticatedImage`/`useAuthenticatedFile` hooks already fetch from
 * (see `avatars.ts` for why avatar fields are file ids, not URLs).
 *
 * File ids minted here all start with `sc-` so `showcaseFileHandlers()` can
 * answer them ahead of the generic `/api/file/:id` handler in `handlers.ts`.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';

// ─────────────────────────────────────────────────────────────────────────
// People
// ─────────────────────────────────────────────────────────────────────────

export type HairStyle = 'short' | 'long' | 'bun' | 'curly' | 'buzz' | 'bob' | 'wavy' | 'bald' | 'ponytail';

export interface AvatarLook {
  skin: string;
  hair: HairStyle;
  hairColor: string;
  /** Two background gradient stops. */
  bg: [string, string];
  shirt: string;
  glasses?: boolean;
  beard?: boolean;
  earrings?: boolean;
}

export const SKIN = {
  porcelain: '#F7D9C4',
  light: '#EFC4A2',
  tan: '#D9A27B',
  olive: '#C08A5E',
  brown: '#9A6240',
  deep: '#6B4028',
} as const;

export const HAIR = {
  black: '#1F1A1C',
  darkBrown: '#3B2519',
  brown: '#6B4226',
  auburn: '#9C3F24',
  blonde: '#D8B26A',
  platinum: '#E9DCC4',
  grey: '#9A9AA4',
  pink: '#E27BA6',
} as const;

const EYE = '#2A2230';
const MOUTH = '#8A3B30';

function hairBack(style: HairStyle, c: string): string {
  switch (style) {
    case 'long':
      return `<path d="M36 64 C33 34 48 24 64 24 C82 24 95 36 92 66 L95 104 C80 110 48 110 33 104 Z" fill="${c}"/>`;
    case 'bob':
      return `<path d="M38 62 C36 34 50 26 64 26 C80 26 93 36 90 62 L91 84 C84 88 44 88 37 84 Z" fill="${c}"/>`;
    case 'curly':
      return [
        [42, 50, 13], [48, 36, 14], [64, 29, 15], [80, 36, 14], [86, 50, 13],
        [38, 64, 10], [90, 64, 10], [56, 30, 12], [72, 30, 12],
      ]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`)
        .join('');
    case 'ponytail':
      return `<path d="M82 40 C100 44 102 70 94 88 C90 80 88 66 84 56 Z" fill="${c}"/>`;
    default:
      return '';
  }
}

function hairFront(style: HairStyle, c: string): string {
  switch (style) {
    case 'short':
      return `<path d="M41 60 C38 38 50 29 64 29 C80 29 91 39 87 60 C85 51 81 45 73 43 C65 47 53 47 47 51 C44 54 42 57 41 60 Z" fill="${c}"/>`;
    case 'buzz':
      return `<path d="M43 56 C42 40 52 33 64 33 C77 33 87 40 85 56 C80 46 72 42 64 42 C56 42 48 46 43 56 Z" fill="${c}" opacity="0.9"/>`;
    case 'long':
    case 'ponytail':
      return `<path d="M42 58 C41 38 52 30 64 30 C79 30 89 40 86 58 C81 47 71 41 59 42 C52 44 46 50 42 58 Z" fill="${c}"/>`;
    case 'bun':
      return (
        `<circle cx="64" cy="25" r="11" fill="${c}"/>` +
        `<path d="M42 58 C41 38 52 31 64 31 C77 31 88 39 86 58 C82 47 74 42 64 42 C54 42 46 48 42 58 Z" fill="${c}"/>`
      );
    case 'bob':
      return `<path d="M41 56 C41 37 52 30 64 30 C77 30 88 37 87 56 L80 50 C72 45 56 45 48 50 Z" fill="${c}"/>`;
    case 'wavy':
      return `<path d="M40 62 C36 40 48 28 64 28 C82 28 93 40 88 62 C86 52 82 46 76 44 C70 50 62 48 56 44 C50 48 44 54 40 62 Z" fill="${c}"/>`;
    case 'curly':
      return `<path d="M44 52 C48 42 56 40 64 40 C72 40 80 42 84 52 C78 46 70 46 64 47 C58 46 50 46 44 52 Z" fill="${c}"/>`;
    case 'bald':
    default:
      return '';
  }
}

/** An illustrated head-and-shoulders avatar, as SVG markup (128×128 viewBox). */
export function illustratedAvatarSvg(key: string, look: AvatarLook, size = 256): string {
  const id = key.replace(/[^a-z0-9]/gi, '');
  const { skin, hair, hairColor, bg, shirt } = look;
  const beard = look.beard
    ? `<path d="M43 62 C44 84 55 92 64 92 C73 92 84 84 85 62 C81 73 74 78 64 78 C54 78 47 73 43 62 Z" fill="${hairColor}"/>`
    : '';
  const glasses = look.glasses
    ? `<g fill="rgba(255,255,255,0.18)" stroke="#20242E" stroke-width="2.2">` +
      `<circle cx="55" cy="62" r="7"/><circle cx="73" cy="62" r="7"/></g>` +
      `<path d="M62 62 L66 62" stroke="#20242E" stroke-width="2.2"/>`
    : '';
  const earrings = look.earrings
    ? `<circle cx="42.5" cy="71" r="2.4" fill="#F5C542"/><circle cx="85.5" cy="71" r="2.4" fill="#F5C542"/>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">` +
    `<defs>` +
    `<linearGradient id="bg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient>` +
    `<clipPath id="c${id}"><circle cx="64" cy="64" r="64"/></clipPath>` +
    `</defs>` +
    `<g clip-path="url(#c${id})">` +
    `<rect width="128" height="128" fill="url(#bg${id})"/>` +
    // Zoom the figure a little so the face reads at 32px list sizes.
    `<g transform="translate(64 70) scale(1.16) translate(-64 -64)">` +
    hairBack(hair, hairColor) +
    // Neck (a touch darker than the face) and shirt.
    `<path d="M55 76 L55 96 L73 96 L73 76 Z" fill="${skin}"/>` +
    `<path d="M55 76 L55 90 C60 93 68 93 73 90 L73 76 Z" fill="#000" opacity="0.12"/>` +
    `<path d="M16 130 C18 106 36 95 64 95 C92 95 110 106 112 130 Z" fill="${shirt}"/>` +
    `<path d="M55 95 L64 106 L73 95 Z" fill="${skin}"/>` +
    // Ears + face.
    `<ellipse cx="42.5" cy="63" rx="4.5" ry="6.5" fill="${skin}"/>` +
    `<ellipse cx="85.5" cy="63" rx="4.5" ry="6.5" fill="${skin}"/>` +
    `<ellipse cx="64" cy="60" rx="21.5" ry="25" fill="${skin}"/>` +
    beard +
    hairFront(hair, hairColor) +
    // Brows, eyes, cheeks, smile.
    `<path d="M50 53.5 Q55 51 59.5 53" stroke="${hairColor === HAIR.platinum ? '#8C7A5E' : hairColor}" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `<path d="M68.5 53 Q73 51 78 53.5" stroke="${hairColor === HAIR.platinum ? '#8C7A5E' : hairColor}" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `<circle cx="55" cy="62" r="2.5" fill="${EYE}"/><circle cx="73" cy="62" r="2.5" fill="${EYE}"/>` +
    `<circle cx="50" cy="70" r="4" fill="#FF7A7A" opacity="0.22"/><circle cx="78" cy="70" r="4" fill="#FF7A7A" opacity="0.22"/>` +
    `<path d="M57 73 Q64 79.5 71 73" stroke="${MOUTH}" stroke-width="2.3" fill="none" stroke-linecap="round"/>` +
    glasses +
    earrings +
    `</g></g></svg>`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Communities
// ─────────────────────────────────────────────────────────────────────────

export type CommunityGlyph = 'couch' | 'lumen' | 'trail' | 'synth';

/** A community logo: gradient tile with a simple geometric glyph. */
export function communityIconSvg(glyph: CommunityGlyph, size = 256): string {
  const tiles: Record<CommunityGlyph, { bg: [string, string]; art: string }> = {
    couch: {
      bg: ['#3B5BDB', '#15AABF'],
      art:
        `<g fill="#FFFFFF">` +
        `<rect x="32" y="40" width="64" height="34" rx="11"/>` +
        `<rect x="20" y="58" width="20" height="38" rx="9"/>` +
        `<rect x="88" y="58" width="20" height="38" rx="9"/>` +
        `<rect x="36" y="72" width="56" height="20" rx="6"/>` +
        `<rect x="28" y="92" width="8" height="12" rx="3"/><rect x="92" y="92" width="8" height="12" rx="3"/>` +
        `</g>` +
        `<path d="M64 74 V90" stroke="#2F6FD0" stroke-width="3" stroke-linecap="round" opacity="0.55"/>`,
    },
    lumen: {
      bg: ['#7C5CFF', '#FF6FB5'],
      art:
        `<g stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" opacity="0.95">` +
        [0, 45, 90, 135, 180, 225, 270, 315]
          .map((deg) => {
            const r = (deg * Math.PI) / 180;
            const x1 = 64 + Math.cos(r) * 30;
            const y1 = 64 + Math.sin(r) * 30;
            const x2 = 64 + Math.cos(r) * 42;
            const y2 = 64 + Math.sin(r) * 42;
            return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
          })
          .join('') +
        `</g><circle cx="64" cy="64" r="19" fill="#FFFFFF"/><circle cx="64" cy="64" r="9" fill="#FFB86B"/>`,
    },
    trail: {
      bg: ['#12B886', '#0B7285'],
      art:
        `<circle cx="88" cy="40" r="10" fill="#FFE8A3"/>` +
        `<path d="M14 100 L50 52 L70 76 L84 60 L114 100 Z" fill="#FFFFFF" opacity="0.95"/>` +
        `<path d="M50 52 L60 65 L54 64 L48 70 L43 62 Z" fill="#12B886" opacity="0.5"/>`,
    },
    synth: {
      bg: ['#FF8A3D', '#E0306F'],
      art: `<g fill="#FFFFFF">${[18, 34, 50, 66, 82, 98]
        .map((x, i) => {
          const h = [28, 56, 40, 70, 46, 24][i];
          return `<rect x="${x + 2}" y="${64 - h / 2}" width="10" height="${h}" rx="5"/>`;
        })
        .join('')}</g>`,
    },
  };
  const t = tiles[glyph];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">` +
    `<defs><linearGradient id="g${glyph}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${t.bg[0]}"/><stop offset="1" stop-color="${t.bg[1]}"/></linearGradient></defs>` +
    `<rect width="128" height="128" fill="url(#g${glyph})"/>` +
    t.art +
    `</svg>`
  );
}

/** A soft, wide banner for a community / profile header. */
export function bannerSvg(from: string, to: string, width = 1200, height = 320): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1200 320">` +
    `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="1200" height="320" fill="url(#b)"/>` +
    `<circle cx="1040" cy="40" r="180" fill="#FFFFFF" opacity="0.08"/>` +
    `<circle cx="160" cy="320" r="220" fill="#FFFFFF" opacity="0.06"/>` +
    `<path d="M0 250 C200 200 380 290 600 240 C820 190 1000 270 1200 220 L1200 320 L0 320 Z" fill="#000000" opacity="0.10"/>` +
    `</svg>`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Message images
// ─────────────────────────────────────────────────────────────────────────

/** Design mock of a friendly "empty channel" state — what Priya shares in #dev. */
export function emptyStateMockSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">` +
    `<defs>` +
    `<linearGradient id="bgm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#EDE7FF"/><stop offset="1" stop-color="#FFE3F1"/></linearGradient>` +
    `<linearGradient id="bub" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#B36BFF"/></linearGradient>` +
    `<filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#4B2E9E" flood-opacity="0.18"/></filter>` +
    `</defs>` +
    `<rect width="960" height="600" fill="url(#bgm)"/>` +
    // App window
    `<g filter="url(#sh)"><rect x="120" y="70" width="720" height="460" rx="22" fill="#FFFFFF"/></g>` +
    `<rect x="120" y="70" width="720" height="52" rx="22" fill="#F6F3FF"/><rect x="120" y="100" width="720" height="22" fill="#F6F3FF"/>` +
    `<circle cx="152" cy="96" r="7" fill="#FF6B6B"/><circle cx="176" cy="96" r="7" fill="#FFC64B"/><circle cx="200" cy="96" r="7" fill="#3DD68C"/>` +
    `<rect x="236" y="89" width="150" height="14" rx="7" fill="#DCD3FF"/>` +
    // Sidebar
    `<rect x="120" y="122" width="170" height="408" fill="#FAF8FF"/>` +
    [0, 1, 2, 3, 4, 5]
      .map((i) => `<rect x="146" y="${150 + i * 34}" width="${[96, 72, 110, 64, 88, 80][i]}" height="12" rx="6" fill="${i === 1 ? '#B8A6FF' : '#E6E0FA'}"/>`)
      .join('') +
    // Illustration: stacked chat bubbles + sparkles
    `<g transform="translate(470 180)">` +
    `<rect x="0" y="40" width="170" height="92" rx="26" fill="url(#bub)"/>` +
    `<path d="M40 128 L30 158 L70 130 Z" fill="#8F63FF"/>` +
    `<rect x="26" y="68" width="96" height="12" rx="6" fill="#FFFFFF" opacity="0.9"/>` +
    `<rect x="26" y="92" width="64" height="12" rx="6" fill="#FFFFFF" opacity="0.6"/>` +
    `<rect x="110" y="0" width="120" height="70" rx="22" fill="#FFD166"/>` +
    `<circle cx="146" cy="35" r="6" fill="#7A4B00"/><circle cx="170" cy="35" r="6" fill="#7A4B00"/><circle cx="194" cy="35" r="6" fill="#7A4B00"/>` +
    `<path d="M-30 10 l6 -16 l6 16 l16 6 l-16 6 l-6 16 l-6 -16 l-16 -6 Z" fill="#FF6FB5"/>` +
    `<path d="M236 110 l4 -10 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 Z" fill="#7C5CFF"/>` +
    `</g>` +
    // Copy + CTA
    `<rect x="444" y="372" width="300" height="20" rx="10" fill="#2D2446"/>` +
    `<rect x="470" y="406" width="248" height="12" rx="6" fill="#B9B2CC"/>` +
    `<rect x="496" y="428" width="196" height="12" rx="6" fill="#B9B2CC"/>` +
    `<rect x="524" y="462" width="140" height="40" rx="20" fill="#7C5CFF"/>` +
    `<rect x="552" y="477" width="84" height="10" rx="5" fill="#FFFFFF"/>` +
    `</svg>`
  );
}

/** A photo-like illustration: sunset over mountains and a lake (shared in #general). */
export function sunsetPhotoSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">` +
    `<defs>` +
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2B2A6B"/><stop offset="0.5" stop-color="#C2508A"/><stop offset="1" stop-color="#FFB36B"/></linearGradient>` +
    `<linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF9E6B"/><stop offset="1" stop-color="#3A2C63"/></linearGradient>` +
    `</defs>` +
    `<rect width="960" height="640" fill="url(#sky)"/>` +
    `<circle cx="600" cy="360" r="70" fill="#FFE2A8" opacity="0.95"/>` +
    `<path d="M0 400 L150 250 L260 330 L400 190 L540 330 L640 270 L780 360 L880 290 L960 340 L960 440 L0 440 Z" fill="#3B2B5C"/>` +
    `<path d="M0 430 L120 330 L240 400 L360 300 L500 420 L640 340 L800 420 L960 360 L960 450 L0 450 Z" fill="#241B40"/>` +
    `<rect y="440" width="960" height="200" fill="url(#lake)"/>` +
    `<g fill="#FFE2A8" opacity="0.55">` +
    [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${560 - i * 6}" y="${460 + i * 22}" width="${80 + i * 12}" height="4" rx="2"/>`).join('') +
    `</g>` +
    `<path d="M0 640 L0 560 C60 540 90 580 150 570 L210 640 Z" fill="#150F29"/>` +
    `</svg>`
  );
}

/** Color palette card (shared in #design). */
export function paletteSvg(): string {
  const swatches = ['#7C5CFF', '#FF6FB5', '#FFB86B', '#3DD68C', '#2D2446'];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">` +
    `<rect width="960" height="540" fill="#15131F"/>` +
    swatches
      .map(
        (c, i) =>
          `<rect x="${60 + i * 172}" y="70" width="152" height="300" rx="18" fill="${c}"/>` +
          `<rect x="${76 + i * 172}" y="396" width="${90 - (i % 2) * 20}" height="16" rx="8" fill="#E9E6F5"/>` +
          `<rect x="${76 + i * 172}" y="424" width="64" height="12" rx="6" fill="#8C86A3"/>`,
      )
      .join('') +
    `</svg>`
  );
}

/**
 * Link-preview banner for the pull request Marcus links in #dev: a slim
 * summary strip (repo, PR number, diff stats, author, language bar), like a
 * code host's social card. Slim on purpose: at 840×156 the whole #dev message,
 * author row included, fits above the fold in the desktop screenshots.
 */
export function prPreviewSvg(author: AvatarLook): string {
  const font = `font-family="Roboto, 'Segoe UI', Helvetica, Arial, 'Liberation Sans', sans-serif"`;
  const avatar = illustratedAvatarSvg('prauthor', author, 80).replace('<svg ', '<svg x="732" y="30" ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="156" viewBox="0 0 840 156">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1E1B33"/><stop offset="1" stop-color="#2C1F4A"/></linearGradient></defs>` +
    `<rect width="840" height="156" fill="url(#p)"/>` +
    // Pull-request glyph.
    `<g fill="none" stroke="#3DD68C" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="50" cy="42" r="10"/><path d="M50 52 V100"/><circle cx="50" cy="110" r="10"/>` +
    `<circle cx="98" cy="110" r="10"/><path d="M98 100 V66 C98 54 92 48 80 48 H68"/><path d="M77 39 L68 48 L77 57"/>` +
    `</g>` +
    `<text x="136" y="64" ${font} font-size="32" font-weight="700" fill="#F3F0FF">lumen-studio/lumen</text>` +
    `<text x="136" y="106" ${font} font-size="25" fill="#A9A3C4">#482 · 6 files changed · <tspan fill="#3DD68C">+128</tspan> <tspan fill="#FF7A7A">−41</tspan></text>` +
    avatar +
    // Language bar.
    `<rect x="0" y="146" width="620" height="10" fill="#3178C6"/><rect x="620" y="146" width="130" height="10" fill="#7C5CFF"/><rect x="750" y="146" width="90" height="10" fill="#F1E05A"/>` +
    `</svg>`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Deep Rift (the fictional game Couch Co-op plays)
// ─────────────────────────────────────────────────────────────────────────

const GAME_FONT = `font-family="Roboto, 'Segoe UI', Helvetica, Arial, 'Liberation Sans', sans-serif"`;

/** A little driller (helmet lamp, overalls), feet at (x, y). Same character as the showcase GIFs. */
function drillerSvg(x: number, y: number, s: number, suit: string, opts: { eyes?: 'open' | 'dizzy'; arm?: number; tilt?: number } = {}): string {
  const ink = 'stroke="#15131F" stroke-width="3.2"';
  const eyes =
    opts.eyes === 'dizzy'
      ? [-8, 8].map((cx) => `<path d="M${cx - 4} -82 L${cx + 4} -74 M${cx + 4} -82 L${cx - 4} -74" stroke="#15131F" stroke-width="2.4" stroke-linecap="round"/>`).join('')
      : `<circle cx="-8" cy="-78" r="2.8" fill="#15131F"/><circle cx="8" cy="-78" r="2.8" fill="#15131F"/>`;
  return (
    `<g transform="translate(${x} ${y}) rotate(${opts.tilt ?? 0}) scale(${s})">` +
    `<rect x="-15" y="-24" width="12" height="24" rx="5" fill="#2D2446" ${ink}/>` +
    `<rect x="3" y="-24" width="12" height="24" rx="5" fill="#2D2446" ${ink}/>` +
    `<rect x="-31" y="-58" width="11" height="30" rx="5" fill="${suit}" ${ink}/>` +
    `<rect x="-23" y="-64" width="46" height="44" rx="12" fill="${suit}" ${ink}/>` +
    `<rect x="-21.5" y="-36" width="43" height="6" fill="#2D2446"/>` +
    `<g transform="translate(25 -56) rotate(${opts.arm ?? 0})"><rect x="-5.5" y="-2" width="11" height="30" rx="5" fill="${suit}" ${ink}/>` +
    `<circle cx="0" cy="30" r="7" fill="#F2C9A0" ${ink}/></g>` +
    `<circle cx="0" cy="-84" r="21" fill="#F2C9A0" ${ink}/>` +
    `<path d="M-24 -88 A24 24 0 0 1 24 -88 Z" fill="#FFD35C" ${ink}/>` +
    `<rect x="-28" y="-90" width="56" height="7" rx="3" fill="#FFD35C" ${ink}/>` +
    `<circle cx="0" cy="-101" r="6.5" fill="#FFF6C9" ${ink}/>` +
    eyes +
    `</g>`
  );
}

/** Link-preview banner for the Deep Rift 6.2 patch notes (dropbear's link in #general). */
export function deepRiftPatchSvg(): string {
  const crystals = [[70, 40, 10], [150, 150, 7], [560, 36, 8], [720, 170, 9], [800, 60, 6]]
    .map(([x, y, s]) => `<path d="M${x} ${y - s * 1.6} L${x + s} ${y} L${x} ${y + s * 1.6} L${x - s} ${y} Z" fill="#5EEAD4"/>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="220" viewBox="0 0 840 220">` +
    `<defs><linearGradient id="dr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1B1530"/><stop offset="1" stop-color="#3A1F4F"/></linearGradient>` +
    `<radialGradient id="drl" cx="0.78" cy="0.35" r="0.5"><stop offset="0" stop-color="#FFD35C" stop-opacity="0.35"/><stop offset="1" stop-color="#FFD35C" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="840" height="220" fill="url(#dr)"/>` +
    `<rect width="840" height="220" fill="url(#drl)"/>` +
    `<path d="M0 180 C120 160 220 190 340 172 C470 152 560 186 700 168 C760 160 800 170 840 164 L840 220 L0 220 Z" fill="#2A2145"/>` +
    crystals +
    `<text x="48" y="102" ${GAME_FONT} font-size="54" font-weight="800" letter-spacing="6" fill="#F3F0FF">DEEP RIFT</text>` +
    `<rect x="50" y="122" width="148" height="40" rx="20" fill="#FF8A3D"/>` +
    `<text x="124" y="150" ${GAME_FONT} font-size="22" font-weight="700" text-anchor="middle" fill="#1B1530">PATCH 6.2</text>` +
    `<text x="216" y="150" ${GAME_FONT} font-size="21" fill="#B9B2CC">driller changes · new biome</text>` +
    drillerSvg(660, 190, 1.35, '#FF8A3D', { arm: -150 }) +
    `</svg>`
  );
}

/** A Deep Rift screenshot: four drillers stuck at the bottom of a pit (gracie's "found this from last time"). */
export function pitScreenshotSvg(): string {
  const rock = '#3B2F5C';
  const hud =
    // Squad health bars, top left; depth readout top right; crosshair.
    [0, 1, 2, 3]
      .map((i) => {
        const suit = ['#FF8A3D', '#3DD68C', '#7C9CFF', '#FF6FB5'][i];
        const hp = [0.35, 0.6, 0.2, 0.8][i];
        return (
          `<circle cx="42" cy="${40 + i * 30}" r="9" fill="${suit}"/>` +
          `<rect x="58" y="${34 + i * 30}" width="120" height="12" rx="6" fill="#000" opacity="0.45"/>` +
          `<rect x="58" y="${34 + i * 30}" width="${120 * hp}" height="12" rx="6" fill="${hp < 0.3 ? '#FF6B6B' : '#3DD68C'}"/>`
        );
      })
      .join('') +
    `<rect x="800" y="28" width="132" height="40" rx="8" fill="#000" opacity="0.45"/>` +
    `<text x="866" y="55" ${GAME_FONT} font-size="20" font-weight="700" text-anchor="middle" fill="#E9E6F5">-214 m</text>` +
    `<g stroke="#FFFFFF" stroke-width="3" opacity="0.7"><path d="M480 250 v10 M480 276 v10 M462 268 h10 M488 268 h10"/></g>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="523" height="257" viewBox="0 20 960 471">` +
    `<defs>` +
    `<linearGradient id="pc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#120E22"/><stop offset="1" stop-color="#2A2145"/></linearGradient>` +
    `<radialGradient id="pl" cx="0.5" cy="0.78" r="0.42"><stop offset="0" stop-color="#FFE9A8" stop-opacity="0.5"/><stop offset="1" stop-color="#FFE9A8" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    `<rect width="960" height="540" fill="url(#pc)"/>` +
    // Pit walls, looking down into it.
    `<path d="M0 0 L300 0 L360 250 L330 540 L0 540 Z" fill="${rock}"/>` +
    `<path d="M960 0 L650 0 L600 260 L640 540 L960 540 Z" fill="${rock}"/>` +
    `<path d="M300 0 L360 250 L330 540" stroke="#54457F" stroke-width="6" fill="none"/>` +
    `<path d="M650 0 L600 260 L640 540" stroke="#54457F" stroke-width="6" fill="none"/>` +
    `<path d="M330 450 C420 430 540 430 640 452 L640 540 L330 540 Z" fill="#241B3D"/>` +
    [[200, 120, 12], [120, 330, 9], [780, 180, 11], [860, 400, 8], [420, 90, 7]]
      .map(([x, y, s]) => `<path d="M${x} ${y - s * 1.6} L${x + s} ${y} L${x} ${y + s * 1.6} L${x - s} ${y} Z" fill="#5EEAD4"/>`)
      .join('') +
    `<rect width="960" height="540" fill="url(#pl)"/>` +
    drillerSvg(400, 470, 1.25, '#FF8A3D', { eyes: 'dizzy', tilt: -8 }) +
    drillerSvg(470, 482, 1.25, '#3DD68C', { arm: -160 }) +
    drillerSvg(540, 472, 1.25, '#7C9CFF', { tilt: 6 }) +
    drillerSvg(600, 486, 1.25, '#FF6FB5', { arm: -40 }) +
    hud +
    `</svg>`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// File-id registry + MSW handlers
// ─────────────────────────────────────────────────────────────────────────

const registry = new Map<string, () => string>();

/** Register an SVG under a `sc-...` file id; returns the id (for avatar/attachment fields). */
export function registerShowcaseFile(id: string, svg: () => string): string {
  if (!id.startsWith('sc-')) throw new Error(`showcase file ids must start with "sc-": ${id}`);
  registry.set(id, svg);
  return id;
}

/** Data URI for an SVG (e.g. a link preview's `imageUrl`, which the app loads directly). */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Serve every registered `sc-` file id; must go BEFORE `makeHandlers()`'s generic `/api/file/:id`. */
export function showcaseFileHandlers(): HttpHandler[] {
  const serve = (id: string) => {
    const make = registry.get(id);
    if (!make) return undefined;
    return new HttpResponse(make(), { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } });
  };
  return [
    http.get('/api/file/:id/thumbnail', ({ params }) => serve(String(params.id))),
    http.get('/api/file/:id', ({ params }) => serve(String(params.id))),
  ];
}
