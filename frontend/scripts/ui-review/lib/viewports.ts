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
  // Opt-in only (see OPT_IN_VIEWPORTS): narrow and wide desktop windows.
  'desktop-1280': { width: 1280, height: 800, isMobile: false, hasTouch: false },
  'desktop-1920': { width: 1920, height: 1080, isMobile: false, hasTouch: false },
};

/**
 * Viewports a story only gets when it names them in `meta.viewports`, so the
 * extra desktop widths don't triple every desktop shot.
 */
export const OPT_IN_VIEWPORTS = ['phone-short', 'desktop-1280', 'desktop-1920'];

/**
 * Viewports ui-review shoots: phone/tablet/desktop, plus phone-short for
 * "*keyboard*" stories and desktop-1280/1920 for stories that ask for them.
 */
export const REVIEW_VIEWPORTS = ['phone', 'phone-short', 'tablet', 'desktop', 'desktop-1280', 'desktop-1920'];

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
 * phone-short, and every other story every requested viewport but the opt-in
 * ones (phone-short, desktop-1280, desktop-1920).
 */
export function viewportsForStory(storyId: string, requested: string[] = REVIEW_VIEWPORTS, own?: string[] | null): string[] {
  if (own) return requested.filter((v) => own.includes(v));
  if (storyId.toLowerCase().includes('keyboard')) return requested.filter((v) => v === 'phone-short');
  return requested.filter((v) => !OPT_IN_VIEWPORTS.includes(v));
}
