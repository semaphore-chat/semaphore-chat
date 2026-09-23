/**
 * Deterministic, network-free "avatars".
 *
 * IMPORTANT: `avatarUrl`/`bannerUrl` (User) and `avatar`/`banner`
 * (Community) are **not** URLs on the real backend — they're raw file ids,
 * a foreign key into the `File` table (`backend/prisma/schema.prisma`
 * `avatarFile`/`bannerFile` relations `fields: [avatarUrl], references:
 * [id]`). Every avatar-rendering component in the app (`UserAvatar`,
 * `CommunityListItem`, `ProfileHeader`, `MobileCommunityDrawer`,
 * `TabletSidebar`, ...) calls `useAuthenticatedImage(fileId)`
 * (`hooks/useAuthenticatedFile.ts`), which does an authenticated
 * `fetch(getApiUrl('/file/' + fileId))` and turns the response into a blob
 * URL — it never treats the field as an already-usable `src`.
 *
 * So `avatarFileId()`/`bannerFileId()` below mint an opaque **fake file
 * id** (not a data URI) to use as the field value, and the `/api/file/:id`
 * handler in `handlers.ts` decodes it back into the matching SVG bytes via
 * `resolveFileSvg()`. This is what makes `useAuthenticatedImage` actually
 * resolve to a picture instead of silently failing on a request to
 * `/api/file/data:image/svg+xml...` (an unhandled-request MSW warning, and
 * a permanently blank avatar).
 */

const PALETTE = [
  '#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245',
  '#3BA55D', '#7289DA', '#F47FFF', '#00B0F4', '#FF7A00',
  '#9B59B6', '#1ABC9C', '#E67E22', '#2ECC71', '#E91E63',
];

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A stable, deterministic solid color for a given key (user id, community id, ...). */
export function colorFor(key: string): string {
  return PALETTE[hash(key) % PALETTE.length];
}

/** Opaque fake file id for a user/community avatar — see module doc comment. */
export function avatarFileId(key: string, label: string): string {
  return `avatar:${key}:${encodeURIComponent(label)}`;
}

/** Opaque fake file id for a user/community banner — see module doc comment. */
export function bannerFileId(key: string): string {
  return `banner:${key}`;
}

/**
 * Resolve a fake file id (`avatarFileId`/`bannerFileId`, or any other
 * arbitrary id — e.g. a message attachment's file id) into SVG markup, for
 * the `/api/file/:id` (and `/thumbnail`) handlers to serve as bytes.
 */
export function resolveFileSvg(
  id: string,
  size: { width: number; height: number },
  attachmentLabel = 'Attachment',
): string {
  if (id.startsWith('avatar:')) {
    const rest = id.slice('avatar:'.length);
    const sep = rest.indexOf(':');
    const key = sep === -1 ? rest : rest.slice(0, sep);
    const label = sep === -1 ? key : decodeURIComponent(rest.slice(sep + 1));
    return initialsAvatar(key, label, size.width);
  }
  if (id.startsWith('banner:')) {
    const key = id.slice('banner:'.length);
    return bannerImage(key, size.width, size.height);
  }
  return placeholderPhoto(id, size.width, size.height, attachmentLabel);
}

/**
 * A square "initials avatar" as a `data:image/svg+xml` URI — deterministic
 * per (key, label). Used directly by `resolveFileSvg()`; not meant to be
 * assigned straight to an `avatarUrl`/`avatar` field (see module doc
 * comment) — use `avatarFileId()` for that.
 */
export function initialsAvatar(key: string, label: string, size = 128): string {
  const bg = colorFor(key);
  const initials = initialsFor(label);
  const fontSize = Math.round(size * 0.4);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${size}" fill="${bg}"/>` +
    `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" ` +
    `font-family="Roboto, Arial, sans-serif" font-size="${fontSize}" font-weight="600" fill="#ffffff">${initials}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** A rectangular banner gradient, deterministic per key. */
export function bannerImage(key: string, width = 640, height = 180): string {
  const c1 = colorFor(key);
  const c2 = colorFor(`${key}:2`);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#g)"/>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** A generic inline "photo" placeholder used for image message attachments. */
export function placeholderPhoto(key: string, width = 480, height = 320, label = 'Photo'): string {
  const c1 = colorFor(key);
  const c2 = colorFor(`${key}:alt`);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#g)"/>` +
    `<circle cx="${width * 0.28}" cy="${height * 0.32}" r="${Math.min(width, height) * 0.12}" fill="rgba(255,255,255,0.85)"/>` +
    `<polygon points="0,${height} ${width * 0.35},${height * 0.55} ${width * 0.6},${height * 0.75} ${width * 0.8},${height * 0.5} ${width},${height}" fill="rgba(255,255,255,0.35)"/>` +
    `<text x="50%" y="94%" text-anchor="middle" font-family="Roboto, Arial, sans-serif" font-size="14" fill="rgba(255,255,255,0.85)">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
