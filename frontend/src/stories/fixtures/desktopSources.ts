/**
 * Fake `desktopCapturer` sources for the Electron screen-share picker
 * (`ScreenSourcePicker`), as the fake bridge's `getDesktopSources()` returns
 * them. Thumbnails and app icons are generated SVG data URLs (no network),
 * drawn to look like a desktop or an app window at the 16:9 the picker shows.
 * Ids follow Electron's format (`screen:<n>:0`, `window:<id>:0`), which is how
 * the picker splits screens from windows.
 */
import type { DesktopSource } from '../../types/electron-api';

const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** A desktop: wallpaper gradient, two windows and a taskbar. */
function screenThumbnail(from: string, to: string): string {
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="320" height="180" fill="url(#g)"/>
      <rect x="28" y="22" width="150" height="100" rx="4" fill="#1e1f22"/>
      <rect x="28" y="22" width="150" height="12" rx="4" fill="#2b2d31"/>
      <rect x="40" y="46" width="90" height="6" rx="3" fill="#5865f2"/>
      <rect x="40" y="60" width="120" height="6" rx="3" fill="#4e5058"/>
      <rect x="40" y="74" width="104" height="6" rx="3" fill="#4e5058"/>
      <rect x="150" y="60" width="140" height="84" rx="4" fill="#f2f3f5"/>
      <rect x="150" y="60" width="140" height="12" rx="4" fill="#d4d7dc"/>
      <rect x="162" y="84" width="96" height="6" rx="3" fill="#99a1ad"/>
      <rect x="162" y="98" width="112" height="6" rx="3" fill="#b5bac1"/>
      <rect y="164" width="320" height="16" fill="#111214" fill-opacity="0.85"/>
      <circle cx="12" cy="172" r="4" fill="#949ba4"/>
    </svg>`,
  );
}

/** An app window: title bar in `accent`, a sidebar and content lines. */
function windowThumbnail(accent: string, background: string, line: string): string {
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
      <rect width="320" height="180" fill="${background}"/>
      <rect width="320" height="18" fill="${accent}"/>
      <circle cx="298" cy="9" r="4" fill="#ffffff" fill-opacity="0.7"/>
      <rect y="18" width="72" height="162" fill="${line}" fill-opacity="0.25"/>
      <rect x="10" y="32" width="50" height="6" rx="3" fill="${line}"/>
      <rect x="10" y="46" width="42" height="6" rx="3" fill="${line}"/>
      <rect x="10" y="60" width="46" height="6" rx="3" fill="${line}"/>
      <rect x="88" y="34" width="180" height="8" rx="4" fill="${accent}"/>
      <rect x="88" y="54" width="210" height="6" rx="3" fill="${line}"/>
      <rect x="88" y="68" width="196" height="6" rx="3" fill="${line}"/>
      <rect x="88" y="82" width="150" height="6" rx="3" fill="${line}"/>
      <rect x="88" y="104" width="206" height="56" rx="4" fill="${line}" fill-opacity="0.35"/>
    </svg>`,
  );
}

/** A 16px app icon: a rounded square in `color` with a letter. */
function appIcon(color: string, letter: string): string {
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="7" fill="${color}"/>
      <text x="16" y="22" font-family="sans-serif" font-size="18" font-weight="700" fill="#ffffff" text-anchor="middle">${letter}</text>
    </svg>`,
  );
}

/** Two monitors and four app windows, one with a long title. */
export const FAKE_DESKTOP_SOURCES: DesktopSource[] = [
  { id: 'screen:0:0', name: 'Entire Screen', display_id: '1', thumbnail: screenThumbnail('#3a4ba8', '#8a3fa0') },
  { id: 'screen:1:0', name: 'Screen 2', display_id: '2', thumbnail: screenThumbnail('#0f6e6e', '#1d3557') },
  {
    id: 'window:4194307:0',
    name: 'Firefox — Semaphore Chat docs',
    thumbnail: windowThumbnail('#e66000', '#fbfbfe', '#cfcfd8'),
    appIcon: appIcon('#e66000', 'F'),
  },
  {
    id: 'window:4194312:0',
    name: 'Visual Studio Code',
    thumbnail: windowThumbnail('#007acc', '#1e1e1e', '#3c3c3c'),
    appIcon: appIcon('#007acc', 'C'),
  },
  {
    id: 'window:4194318:0',
    name: 'Terminal',
    thumbnail: windowThumbnail('#2e3436', '#101214', '#3b8f3b'),
    appIcon: appIcon('#2e3436', 'T'),
  },
  {
    id: 'window:4194325:0',
    name: 'quarterly-roadmap-final-v3 (1) (copy).odp — LibreOffice Impress presentation',
    thumbnail: windowThumbnail('#d0582f', '#ffffff', '#e3d5cf'),
    appIcon: appIcon('#d0582f', 'L'),
  },
];
