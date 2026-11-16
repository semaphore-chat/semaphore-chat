import type { MessageSegment } from '../../kit';
import type { IntensityName, ModeName } from '../../theme/derive/derivePalette';

export const noop = () => undefined;

/** The three palettes every chat-piece story renders in. */
export const PALETTES: { name: string; mode: ModeName; base?: string; intensity?: IntensityName }[] = [
  { name: 'dark', mode: 'dark' },
  { name: 'light', mode: 'light' },
  { name: 'tinted', mode: 'dark', base: '#0d9488', intensity: 'vibrant' },
];

export const text = (value: string): MessageSegment[] => [{ type: 'text', text: value }];

/** A small coloured square standing in for a custom emoji image (a data URL, so stories need no network). */
export const PARROT_SRC =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#6FD39A"/><circle cx="9" cy="10" r="2" fill="#121214"/><circle cx="15" cy="10" r="2" fill="#121214"/></svg>',
  );
