/**
 * The call surface (design §3.6, §5; closes R8): the video of the call you are in, in the call slot above the
 * call bar, while you are on a Lounge screen. Its own lazy chunk: the call slot loads it only while there is
 * something to show (a remote share or camera published, or your own share). The slot's kit `CallStack`
 * bounds its height (it scrolls inside itself) and swaps it for one summary line while the keyboard is up.
 *
 * - A tile you do not watch is a row with its label and Watch (the classic "Click to watch"): nothing is
 *   received until you choose it, as in the classic app. Beyond `OFFERED_ROWS` of them a summary row counts
 *   them all and offers the call view, which lists every one.
 * - A watched tile is a kit MediaTile with the video; shares come first, then cameras.
 * - "Stop watching" stops watching everything you watch in the call (the classic stage tile's stop-watching
 *   function), so no stream stays subscribed with nothing on screen. This differs from the classic overlay's
 *   close button, which only hides the tiles.
 * - Your own share: a row with Stop sharing (no picker needed to stop).
 *
 * Starting a share, the camera and everything else of the call view are reached through the bar's room name (Open
 * call view); "See all" here opens it too, for the shares and cameras past the first rows.
 */
import { useCallback, useRef, type JSX } from 'react';
import { Button, Card, Icon, ListRow, MediaTile, Stack } from '../../../../kit';
import type { CallVideoTile, CallVideoTrack } from '../../../../data/callVideo';
import { OFFERED_ROWS, offeredSummary, tileLabel } from '../../pieces/call/callSurfaceText';

export interface CallSurfaceProps {
  tiles: readonly CallVideoTile[];
  /** Your own screen share is on. */
  sharingScreen: boolean;
  onWatch(tile: CallVideoTile): void;
  onStopWatching(): void;
  onStopSharing(): void;
  onOpenCallView(): void;
}

/**
 * One watched tile: the video once its track has arrived, the label until then. The track is attached once per
 * `<video>` element and detached from that same element when the element goes (the tile unmounts or stops
 * showing video) or the track changes; a re-render with the same track touches nothing.
 */
export function VideoTile({ tile }: { tile: CallVideoTile }): JSX.Element {
  const shown = useRef<{ element: HTMLVideoElement; track: CallVideoTrack } | null>(null);
  const { track } = tile;
  const attach = useCallback(
    (element: HTMLVideoElement | null) => {
      if (shown.current !== null) {
        shown.current.track.detach(shown.current.element);
        shown.current = null;
      }
      if (element !== null && track !== null) {
        track.attach(element);
        shown.current = { element, track };
      }
    },
    [track],
  );
  return (
    <MediaTile
      kind={tile.kind}
      label={tileLabel(tile)}
      speaking={tile.speaking}
      videoRef={track ? attach : undefined}
    />
  );
}

/** A tile you do not watch: who shares what, and Watch. */
function WatchRow({ tile, onWatch }: { tile: CallVideoTile; onWatch(tile: CallVideoTile): void }): JSX.Element {
  return (
    <ListRow
      primary={tile.kind === 'screen' ? `${tile.name} is sharing their screen` : `${tile.name}'s camera is on`}
      leading={<Icon name={tile.kind === 'screen' ? 'ScreenShare' : 'Video'} tone="secondary" />}
      trailing={
        <Button variant="soft" size="sm" aria-label={`Watch ${tileLabel(tile)}`} onClick={() => onWatch(tile)}>
          Watch
        </Button>
      }
    />
  );
}

export function CallSurface({
  tiles,
  sharingScreen,
  onWatch,
  onStopWatching,
  onStopSharing,
  onOpenCallView,
}: CallSurfaceProps): JSX.Element {
  const watched = tiles.filter((tile) => tile.watched);
  const offered = tiles.filter((tile) => !tile.watched);
  const many = offered.length > OFFERED_ROWS;

  // The arrangement is the kit's: the Card stacks its parts, the watched tiles sit in a Stack, each row is a
  // ListRow.
  return (
    <div role="region" aria-label="Call video" data-testid="lounge-call-surface">
      <Card padding="md">
        {watched.length > 0 && (
          <Stack gap="sm">
            {watched.map((tile) => (
              <VideoTile key={tile.id} tile={tile} />
            ))}
          </Stack>
        )}
        {watched.length > 0 && (
          <ListRow
            primary={watched.length === 1 ? `Watching ${tileLabel(watched[0])}` : `Watching ${watched.length}`}
            trailing={
              <Button variant="soft" size="sm" onClick={onStopWatching}>
                Stop watching
              </Button>
            }
          />
        )}
        {offered.length > 0 && (
          <Stack gap="xs">
            {many && (
              <ListRow
                primary={offeredSummary(offered)}
                trailing={
                  <Button variant="ghost" size="sm" aria-label="See all in the call view" onClick={onOpenCallView}>
                    See all
                  </Button>
                }
              />
            )}
            {offered.slice(0, OFFERED_ROWS).map((tile) => (
              <WatchRow key={tile.id} tile={tile} onWatch={onWatch} />
            ))}
          </Stack>
        )}
        {sharingScreen && (
          <ListRow
            primary="You're sharing your screen"
            leading={<Icon name="ScreenShare" tone="accent" />}
            trailing={
              <Button variant="danger" size="sm" onClick={onStopSharing}>
                Stop sharing
              </Button>
            }
          />
        )}
      </Card>
    </div>
  );
}

export default CallSurface;
