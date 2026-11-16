/**
 * The call surface (shell/lounge/call/surface/CallSurface.tsx) above the call bar in the kit's CallStack, as
 * the call slot composes them, from a fake of the call video (canvas pictures, no LiveKit): a watched screen
 * share, a camera, two and four tiles, your own share with Stop sharing, what is offered but not watched (the
 * surface after Stop watching, and ten cameras at once), the on-screen keyboard (one summary line), and a long
 * room name with everything showing. However much there is, the surface scrolls inside its share of the
 * frame and the bar (Mute, Leave) keeps its whole row.
 */
import { CallStack } from '../../kit';
import { CallSurface } from '../../shell/lounge/call/surface/CallSurface';
import { CallBar } from '../../shell/lounge/pieces/call/CallBar';
import { CallSurfaceSummary } from '../../shell/lounge/pieces/call/CallSurfaceSummary';
import type { CallBarModel } from '../../data/callBar';
import type { CallVideoTile } from '../../data/callVideo';
import type { ModeName } from '../../theme/derive/derivePalette';
import { CallSlotFrame } from '../fixtures/CallSlotFrame';
import { LONG_PLACE, MIC, canvasTrack, fakeCallBarModel, fakeTile } from '../fixtures/callBarFixtures';

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
const otherScreen = fakeTile({ id: 'u-sol:screen', identity: 'u-sol', name: 'sol' });

const NAMES = ['aiko', 'pri', 'dropbear', 'mo', 'lune', 'kestrel', 'juno', 'ravi', 'sol', 'tamsin'];
const COLOURS = ['#2B4C7E', '#7E2B5C', '#2B7E4C', '#7E5C2B'];
/** Someone's camera, watched (with a picture) or only offered. */
const cameraOf = (name: string, i: number, watched: boolean): CallVideoTile =>
  fakeTile({
    id: `u-${name}:camera`,
    identity: `u-${name}`,
    name,
    kind: 'camera',
    watched,
    track: watched ? canvasTrack(COLOURS[i % COLOURS.length], name) : null,
  });
const fourWatched = [screen, ...NAMES.slice(0, 3).map((name, i) => cameraOf(name, i + 1, true))];
const tenOffered = NAMES.map((name, i) => cameraOf(name, i, false));

function Surface({
  mode = 'dark',
  tiles,
  sharingScreen = false,
  keyboard = false,
  banners = 0,
  model = {},
}: {
  mode?: ModeName;
  tiles: CallVideoTile[];
  sharingScreen?: boolean;
  keyboard?: boolean;
  banners?: 0 | 1 | 2;
  model?: Partial<Omit<CallBarModel, 'actions'>>;
}) {
  return (
    <CallSlotFrame mode={mode} keyboard={keyboard} banners={banners}>
      {() => (
        <CallStack
          bar={<CallBar model={fakeCallBarModel({ talking: 'dropbear', sharingScreen, ...model })} />}
          surface={
            <CallSurface
              tiles={tiles}
              sharingScreen={sharingScreen}
              onWatch={noop}
              onStopWatching={noop}
              onStopSharing={noop}
              onOpenCallView={noop}
            />
          }
          summary={<CallSurfaceSummary tiles={tiles} sharingScreen={sharingScreen} onStopSharing={noop} />}
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
/** Two watched tiles, one under the other: the share first, then the camera. */
export const TwoTiles = () => <Surface tiles={[screen, camera]} />;
/** Two tiles, light. */
export const TwoTilesLight = () => <Surface mode="light" tiles={[screen, camera]} />;
/** Four watched tiles: the surface keeps to its share of the frame and scrolls; Mute and Leave stay whole. */
export const FourTiles = () => <Surface tiles={fourWatched} />;
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
/** Ten cameras on, none watched: a summary row ("10 cameras on", See all) above the first three. */
export const TenCameras = () => <Surface tiles={tenOffered} />;
/** A watched share beside an offered camera, while you share too. */
export const Mixed = () => <Surface tiles={[screen, offeredCamera]} sharingScreen />;
/** One watched tile with the on-screen keyboard up: the surface is one summary line, the composer keeps its room. */
export const OneTileKeyboard = () => <Surface tiles={[screen]} keyboard />;
/** Two watched tiles with the keyboard up: still one line. */
export const TwoTilesKeyboard = () => <Surface tiles={[screen, camera]} keyboard />;
/**
 * The longest room name with everything showing: reconnecting, a mic blocked by a moderator (its reason on its
 * own line), two watched tiles, five more offered, your own share.
 */
export const LongNameEverything = () => (
  <Surface
    tiles={[screen, otherScreen, camera, ...tenOffered.slice(3, 7)]}
    sharingScreen
    model={{ place: LONG_PLACE, phase: 'reconnecting', reconnectAttempt: 3, mic: MIC.serverMuted }}
  />
);

const everything = {
  tiles: [screen, otherScreen, camera, ...tenOffered.slice(3, 7)],
  sharingScreen: true,
  model: { place: LONG_PLACE, phase: 'reconnecting', reconnectAttempt: 3, mic: MIC.serverMuted } as const,
};
/** Everything, under one app banner: the video gives way first; the pane keeps a composer's height. */
export const EverythingOneBanner = () => <Surface {...everything} banners={1} />;
/** Everything, under two app banners: the video gives way further; the dock and the bar stay whole. */
export const EverythingTwoBanners = () => <Surface {...everything} banners={2} />;
/** Two banners with the keyboard up, reconnecting and a reason line: Leave and Mute stay whole (the bar wins). */
export const EverythingTwoBannersKeyboard = () => <Surface {...everything} banners={2} keyboard />;
/** Your own share with the keyboard up: the one-line summary keeps Stop sharing. */
export const OwnShareKeyboard = () => <Surface tiles={[screen]} sharingScreen keyboard />;
