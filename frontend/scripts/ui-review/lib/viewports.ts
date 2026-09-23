/**
 * Viewports and the keyboard-story rule, mirroring `scripts/ux-shots.mjs`
 * (keep the two in sync — ux-shots stays a self-contained script).
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

/** Same rule as ux-shots: "*keyboard*" stories only get phone-short, everything else never does. */
export function viewportsForStory(storyId: string, requested: string[] = REVIEW_VIEWPORTS): string[] {
  if (storyId.toLowerCase().includes('keyboard')) return requested.filter((v) => v === 'phone-short');
  return requested.filter((v) => v !== 'phone-short');
}
