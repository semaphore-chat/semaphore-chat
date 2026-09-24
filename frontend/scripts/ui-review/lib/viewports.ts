/**
 * Viewports, the keyboard-story rule and per-story viewports, mirroring
 * `scripts/ux-shots.mjs` (keep the two in sync — ux-shots stays a
 * self-contained script).
 */
export interface Viewport {
  width: number;
  height: number;
  isMobile: boolean;
  hasTouch: boolean;
}

export const VIEWPORTS: Record<string, Viewport> = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
  'phone-short': { width: 390, height: 500, isMobile: true, hasTouch: true },
  tablet: { width: 820, height: 1180, isMobile: false, hasTouch: true },
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false },
};

/** Viewports ui-review shoots: phone/tablet/desktop, plus phone-short for "*keyboard*" stories. */
export const REVIEW_VIEWPORTS = ['phone', 'phone-short', 'tablet', 'desktop'];

/**
 * A story's own viewports, from its Ladle meta (`Story.meta = { viewports: ['phone'] }`,
 * which Ladle copies into meta.json): null when it sets none. Throws when
 * `viewports` is set but isn't a non-empty list of known viewport names.
 */
export function storyViewports(meta: unknown): string[] | null {
  if (!meta || typeof meta !== 'object' || !('viewports' in meta)) return null;
  const list = (meta as { viewports: unknown }).viewports;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`meta.viewports must be a non-empty list of ${Object.keys(VIEWPORTS).join(', ')}`);
  }
  const unknown = list.filter((v) => typeof v !== 'string' || !(v in VIEWPORTS));
  if (unknown.length) {
    throw new Error(
      `meta.viewports has unknown viewport(s) ${unknown.map((v) => JSON.stringify(v)).join(', ')} (known: ${Object.keys(VIEWPORTS).join(', ')})`,
    );
  }
  return [...new Set(list as string[])];
}

/**
 * The viewports to shoot a story at, out of `requested`: its own (`own`, see
 * `storyViewports`) when it sets them; else "*keyboard*" stories only get
 * phone-short, and every other story every requested viewport but phone-short.
 */
export function viewportsForStory(storyId: string, requested: string[] = REVIEW_VIEWPORTS, own?: string[] | null): string[] {
  if (own) return requested.filter((v) => own.includes(v));
  if (storyId.toLowerCase().includes('keyboard')) return requested.filter((v) => v === 'phone-short');
  return requested.filter((v) => v !== 'phone-short');
}
