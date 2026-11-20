import { useState, type JSX } from 'react';
import { MediaViewer, type MediaViewerItem } from '../../kit';
import type { IntensityName, ModeName } from '../../theme/derive/derivePalette';
import { KitStage } from '../fixtures/kitStory';

/** A picture as a data URL, so stories need no network. */
const picture = (w: number, h: number, fill: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="#121214"/></svg>`,
  );

const FIVE: MediaViewerItem[] = [
  { src: picture(1600, 900, '#FFA366'), name: 'sunset.png' },
  { src: picture(600, 1200, '#6FB1F5'), name: 'tall.png' },
  { name: 'still-loading.png' },
  { src: picture(800, 800, '#5FD49A'), name: 'a-very-long-picture-name-from-the-trip-that-does-not-fit-on-one-line.jpg' },
  { name: 'broken.png', failed: true },
];

function Viewer({ items, start = 0, mode = 'dark', base, intensity, download = true }: {
  items: MediaViewerItem[];
  start?: number;
  mode?: ModeName;
  base?: string;
  intensity?: IntensityName;
  download?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(start);
  return (
    <KitStage mode={mode} base={base} intensity={intensity}>
      <button type="button" onClick={() => setOpen(true)}>
        Open the viewer
      </button>
      <MediaViewer
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        index={index}
        onIndexChange={setIndex}
        onDownload={download ? () => undefined : undefined}
      />
    </KitStage>
  );
}

/** One picture: no count, no Previous or Next. */
export const Single = () => <Viewer items={FIVE.slice(0, 1)} />;
export const SingleLight = () => <Viewer items={FIVE.slice(0, 1)} mode="light" />;
/** Five pictures, the first showing: "1 of 5", Previous unavailable. */
export const Several = () => <Viewer items={FIVE} />;
export const SeveralLight = () => <Viewer items={FIVE} mode="light" />;
export const SeveralTinted = () => <Viewer items={FIVE} base="#0d9488" intensity="vibrant" />;
/** A tall picture fits the height. */
export const Tall = () => <Viewer items={FIVE} start={1} />;
/** The full picture is on its way. */
export const Loading = () => <Viewer items={FIVE} start={2} />;
/** A long name gives way; the last one, so Next is unavailable. */
export const LongName = () => <Viewer items={FIVE.slice(0, 4)} start={3} />;
/** The picture could not be loaded. */
export const Failed = () => <Viewer items={FIVE} start={4} download={false} />;
