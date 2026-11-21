/**
 * The kit PickerGrid: the emoji picker's sections of glyph cells (with custom emoji pictures) and the GIF picker's
 * media cells, on the three palettes, and at the narrowest phone width. Tab into a grid and use the arrow keys.
 */
import type { JSX } from 'react';
import { PickerGrid, type PickerGridSection } from '../../kit';
import { Row } from '../fixtures/kitStory';
import { ChatColumn, OnPalette } from './kitChatFixtures';
import { PALETTES, noop } from './kitChatData';

const square = (colour: string, label: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${colour}"/><text x="16" y="21" font-size="12" text-anchor="middle" fill="#121214">${label}</text></svg>`,
  )}`;
const wide = (colour: string, label: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 110"><rect width="160" height="110" fill="${colour}"/><text x="80" y="62" font-size="18" text-anchor="middle" fill="#121214">${label}</text></svg>`,
  )}`;

const GLYPHS = ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙'];
const EMOJI: PickerGridSection[] = [
  { id: 'recent', title: 'Recently used', items: ['🔥', '👍', '🎉'].map((g) => ({ id: g, label: g, glyph: g })) },
  {
    id: 'custom',
    title: 'Custom',
    items: [
      { id: 'c1', label: ':party_parrot:', src: square('#FF8FB8', 'pp') },
      { id: 'c2', label: ':blobwave:', src: square('#6FB1F5', 'bw') },
      { id: 'c3', label: ':catjam:', src: square('#5FD49A', 'cj') },
    ],
  },
  { id: 'people', title: 'Smileys & People', items: GLYPHS.map((g) => ({ id: g, label: g, glyph: g })) },
];
const GIFS: PickerGridSection[] = [
  {
    id: 'gifs',
    items: ['#FF8FB8', '#6FB1F5', '#5FD49A', '#F5C26F', '#B28DFF', '#FF9F6F', '#8FE3FF', '#E3FF8F'].map((c, i) => ({
      id: `g${i}`,
      label: `GIF ${i + 1}`,
      src: wide(c, `GIF ${i + 1}`),
    })),
  },
];

const Body = (): JSX.Element => (
  <>
    <Row label="Emoji: recently used, custom pictures, a built-in section">
      <ChatColumn width={400}>
        <PickerGrid label="Emoji" sections={EMOJI} onPick={noop} />
      </ChatColumn>
    </Row>
    <Row label="GIFs: media cells, cropped to fit">
      <ChatColumn width={400}>
        <PickerGrid label="GIFs" variant="media" sections={GIFS} onPick={noop} />
      </ChatColumn>
    </Row>
  </>
);

export const Grids = () => (
  <OnPalette palette={PALETTES[0]}>
    <Body />
  </OnPalette>
);

export const GridsLight = () => (
  <OnPalette palette={PALETTES[1]}>
    <Body />
  </OnPalette>
);

export const GridsTinted = () => (
  <OnPalette palette={PALETTES[2]}>
    <Body />
  </OnPalette>
);

/** The narrowest phone (320 px): fewer columns, cells stay at least a touch target wide. */
export const Narrow320 = () => (
  <OnPalette palette={PALETTES[0]}>
    <ChatColumn width={288}>
      <PickerGrid label="Emoji" sections={EMOJI} onPick={noop} />
    </ChatColumn>
  </OnPalette>
);
Narrow320.meta = { viewports: ['phone'] };
