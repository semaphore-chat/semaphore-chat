/**
 * The call surface (shell/lounge/call/surface/CallSurface.tsx) above the call bar, from a fake of the call
 * video (canvas pictures, no LiveKit): a watched screen share, a camera, two tiles, your own share with Stop
 * sharing, and what is offered but not watched (the surface after Stop watching).
 */
import { CallSurface } from '../../shell/lounge/call/surface/CallSurface';
import { CallBar } from '../../shell/lounge/pieces/call/CallBar';
import type { CallVideoTile } from '../../data/callVideo';
import type { ModeName } from '../../theme/derive/derivePalette';
import { CallSlotFrame } from '../fixtures/CallSlotFrame';
import { canvasTrack, fakeCallBarModel, fakeTile } from '../fixtures/callBarFixtures';

const noop = () => undefined;

const screen = fakeTile({ watched: true, track: canvasTrack('#2B4C7E', "dropbear's screen"), speaking: true });
const camera = fakeTile({
  id: 'u-pri:camera',
  identity: 'u-pri',
  name: 'pri',
  kind: 'camera',
  watched: true,
  track: canvasTrack('#7E2B5C', 'pri'),
});
const offeredScreen = fakeTile();
const offeredCamera = fakeTile({ id: 'u-pri:camera', identity: 'u-pri', name: 'pri', kind: 'camera' });

function Surface({
  mode = 'dark',
  tiles,
  sharingScreen = false,
}: {
  mode?: ModeName;
  tiles: CallVideoTile[];
  sharingScreen?: boolean;
}) {
  return (
    <CallSlotFrame mode={mode}>
      {(width) => (
        <CallBar
          model={fakeCallBarModel({ talking: 'dropbear', sharingScreen })}
          width={width}
          above={
            <CallSurface
              tiles={tiles}
              sharingScreen={sharingScreen}
              onWatch={noop}
              onStopWatching={noop}
              onStopSharing={noop}
              onOpenCallView={noop}
            />
          }
        />
      )}
    </CallSlotFrame>
  );
}

/** dropbear shares a screen and you watch it. */
export const Screen = () => <Surface tiles={[screen]} />;
/** The same, light. */
export const ScreenLight = () => <Surface mode="light" tiles={[screen]} />;
/** A camera you watch. */
export const Camera = () => <Surface tiles={[camera]} />;
/** Two watched tiles side by side: the share first, then the camera. */
export const TwoTiles = () => <Surface tiles={[screen, camera]} />;
/** Two tiles, light. */
export const TwoTilesLight = () => <Surface mode="light" tiles={[screen, camera]} />;
/** A watched share whose picture has not arrived yet: the label until the first frame. */
export const Subscribing = () => <Surface tiles={[{ ...screen, track: null }]} />;
/** Your own share: Stop sharing. */
export const OwnShare = () => <Surface tiles={[]} sharingScreen />;
/** Your own share, light. */
export const OwnShareLight = () => <Surface mode="light" tiles={[]} sharingScreen />;
/** Nothing watched (a new share, or after Stop watching): each one offered with Watch, nothing received. */
export const NotWatched = () => <Surface tiles={[offeredScreen, offeredCamera]} />;
/** Not watched, light. */
export const NotWatchedLight = () => <Surface mode="light" tiles={[offeredScreen, offeredCamera]} />;
/** A watched share beside an offered camera, while you share too. */
export const Mixed = () => <Surface tiles={[screen, offeredCamera]} sharingScreen />;
