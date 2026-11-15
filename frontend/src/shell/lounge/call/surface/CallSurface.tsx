/**
 * The call surface (design §3.6, §5; closes R8): the video of the call you are in, in the call slot above the
 * call bar, while you are on a Lounge screen. Its own lazy chunk: the call slot loads it only while there is
 * something to show (a remote share or camera published, or your own share).
 *
 * - A tile you do not watch is a row with its label and Watch (the classic "Click to watch"): nothing is
 *   received until you choose it, as in the classic app.
 * - A watched tile is a kit MediaTile with the video; shares come first, then cameras.
 * - "Stop watching" stops watching every tile shown (the classic stage tile's stop-watching function), so no
 *   stream stays subscribed with nothing on screen. This differs from the classic overlay's close button,
 *   which only hides the tiles.
 * - Your own share: a row with Stop sharing (no picker needed to stop).
 *
 * Starting a share, the camera and everything else of the call view are reached with "Open call view".
 */
import { useCallback, useRef, type JSX } from 'react';
import { Button, Card, Icon, IconButton, ListRow, MediaTile } from '../../../../kit';
import type { CallVideoTile, CallVideoTrack } from '../../../../data/callVideo';

export interface CallSurfaceProps {
  tiles: readonly CallVideoTile[];
  /** Your own screen share is on. */
  sharingScreen: boolean;
  onWatch(tile: CallVideoTile): void;
  onStopWatching(): void;
  onStopSharing(): void;
  onOpenCallView(): void;
}

function tileLabel(tile: Pick<CallVideoTile, 'name' | 'kind'>): string {
  return tile.kind === 'screen' ? `${tile.name}'s screen` : tile.name;
}

/** One watched tile: the video once its track has arrived, the label until then. */
function VideoTile({ tile }: { tile: CallVideoTile }): JSX.Element {
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

  // The arrangement is the kit's: the Card stacks its children (tiles, then rows), each row a ListRow.
  // TODO(kit Stack): two watched tiles side by side (a row Stack) instead of one above the other.
  return (
    <div role="region" aria-label="Call video" data-testid="lounge-call-surface">
      <Card padding="md">
        {watched.map((tile) => (
          <VideoTile key={tile.id} tile={tile} />
        ))}
        {watched.length > 0 && (
          <ListRow
            primary={watched.length === 1 ? `Watching ${tileLabel(watched[0])}` : `Watching ${watched.length}`}
            trailing={
              <>
                <Button variant="soft" size="sm" onClick={onStopWatching}>
                  Stop watching
                </Button>
                <IconButton icon="Maximize" label="Open call view" size="sm" onClick={onOpenCallView} />
              </>
            }
          />
        )}
        {offered.map((tile) => (
          <WatchRow key={tile.id} tile={tile} onWatch={onWatch} />
        ))}
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
