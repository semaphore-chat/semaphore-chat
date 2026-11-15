import { useCallback, type JSX } from 'react';
import { MediaTile, type MediaTileProps } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage, Row } from '../fixtures/kitStory';

/** A moving picture to stand in for a stream: a canvas drawn once and captured as a MediaStream. */
function useFakeStream(hue: number, text: string) {
  return useCallback(
    (video: HTMLVideoElement | null) => {
      if (video === null || video.srcObject !== null) return;
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext('2d');
      if (context === null || typeof canvas.captureStream !== 'function') return;
      const gradient = context.createLinearGradient(0, 0, 640, 360);
      gradient.addColorStop(0, `hsl(${hue} 60% 38%)`);
      gradient.addColorStop(1, `hsl(${(hue + 60) % 360} 70% 22%)`);
      const paint = () => {
        context.fillStyle = gradient;
        context.fillRect(0, 0, 640, 360);
        context.fillStyle = 'rgba(255,255,255,0.85)';
        context.font = '48px sans-serif';
        context.textAlign = 'center';
        context.fillText(text, 320, 200);
      };
      paint();
      video.srcObject = canvas.captureStream(5);
      // Keep drawing so the captured stream has frames.
      const timer = window.setInterval(paint, 200);
      video.addEventListener('emptied', () => window.clearInterval(timer), { once: true });
    },
    [hue, text],
  );
}

function Tile(props: Omit<MediaTileProps, 'videoRef'> & { video?: boolean; hue?: number }): JSX.Element {
  const { video = false, hue = 260, ...rest } = props;
  const ref = useFakeStream(hue, rest.label);
  return <MediaTile {...rest} videoRef={video ? ref : undefined} />;
}

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: tokens.space.lg,
  width: '100%',
} as const;

const KindsBody = () => (
  <>
    <Row label="With video: a shared screen, a camera">
      <div style={grid}>
        <Tile kind="screen" label="dropbear's screen" video hue={200} />
        <Tile kind="camera" label="pri" video hue={320} />
      </div>
    </Row>
    <Row label="No video: avatar, camera and screen show the label">
      <div style={grid}>
        <Tile kind="avatar" label="aiko" />
        <Tile kind="camera" label="kwam3" />
        <Tile kind="screen" label="alexk's screen" />
      </div>
    </Row>
  </>
);

/** The three kinds, with and without a video. */
export const Kinds = () => (
  <KitStage mode="dark">
    <KindsBody />
  </KitStage>
);

export const KindsLight = () => (
  <KitStage mode="light">
    <KindsBody />
  </KitStage>
);

export const KindsTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <KindsBody />
  </KitStage>
);

const SpeakingBody = () => (
  <Row label="Speaking: the ring, on a camera, a screen and an avatar">
    <div style={grid}>
      <Tile kind="camera" label="dropbear" video hue={140} speaking />
      <Tile kind="screen" label="pri's screen" video hue={30} speaking />
      <Tile kind="avatar" label="dropbear" speaking />
    </div>
  </Row>
);

export const Speaking = () => (
  <KitStage mode="dark">
    <SpeakingBody />
  </KitStage>
);

export const SpeakingLight = () => (
  <KitStage mode="light">
    <SpeakingBody />
  </KitStage>
);

/** A long label in a narrow (200 px) tile: the label is cut with an ellipsis, over video and without. */
export const LongLabel = () => (
  <KitStage mode="dark">
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg, width: 200, maxWidth: '100%' }}>
      <Tile kind="camera" label="Squad Up: dropbear with an extremely long display name" video hue={90} />
      <Tile kind="avatar" label="Squad Up: dropbear with an extremely long display name" />
    </div>
  </KitStage>
);

const SizesBody = () => (
  <>
    {[120, 160, 180, 220].map((width) => (
      <Row key={width} label={`${width} px wide: the avatar and padding step down, then the name goes`}>
        <div style={{ width }}>
          <Tile kind="avatar" label="dropbear" />
        </div>
        <div style={{ width }}>
          <Tile kind="camera" label="pri" video hue={200} />
        </div>
      </Row>
    ))}
    <Row label="Full width">
      <div style={{ width: '100%' }}>
        <Tile kind="avatar" label="dropbear" />
      </div>
    </Row>
  </>
);

/** An avatar tile at 120, 160, 180, 220 px and full width: nothing is cut off at any size. */
export const SmallTiles = () => (
  <KitStage mode="dark">
    <SizesBody />
  </KitStage>
);

export const SmallTilesLight = () => (
  <KitStage mode="light">
    <SizesBody />
  </KitStage>
);

/** The tile is bigger than the viewport allows: two avatar tiles side by side on a phone. */
export const PhonePair = () => (
  <KitStage mode="dark">
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: tokens.space.md, width: '100%' }}>
      <Tile kind="avatar" label="dropbear" speaking />
      <Tile kind="avatar" label="Squad Up: pri" />
      <Tile kind="camera" label="aiko" video hue={30} />
      <Tile kind="avatar" label="kwam3" />
    </div>
  </KitStage>
);

