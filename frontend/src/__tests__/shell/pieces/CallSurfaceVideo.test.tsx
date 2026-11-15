/**
 * The call surface's video lifetime (review I4): a watched tile attaches its track to its `<video>` once per
 * element, detaches it from that same element when the element goes (Stop watching, the share ending, the
 * surface unmounting), never re-attaches on a re-render, and on a track or kind change detaches the old one
 * before the new one attaches. Each `attach` is matched by exactly one `detach` with the same element.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { CallSurface } from '../../../shell/lounge/call/surface/CallSurface';
import type { CallVideoTile } from '../../../data/callVideo';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { fakeTile } from '../../../stories/fixtures/callBarFixtures';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

/** A track that records which element it is shown in, so attach and detach can be paired. */
function fakeTrack() {
  const log: string[] = [];
  const elements: HTMLMediaElement[] = [];
  const track = {
    attach: vi.fn((el: HTMLMediaElement) => {
      elements.push(el);
      log.push(`attach ${elements.indexOf(el)}`);
      return el;
    }),
    detach: vi.fn((el: HTMLMediaElement) => {
      log.push(`detach ${elements.indexOf(el)}`);
      return el;
    }),
  };
  return { track, log, elements };
}

const noop = () => undefined;
function surface(tiles: CallVideoTile[]) {
  return (
    <CallSurface
      tiles={tiles}
      sharingScreen={false}
      onWatch={noop}
      onStopWatching={noop}
      onStopSharing={noop}
      onOpenCallView={noop}
    />
  );
}

describe('CallSurface: the video of a watched tile', () => {
  it('attaches once to the tile’s <video>, and a re-render (speaking, other tiles) attaches nothing again', () => {
    const { track, log } = fakeTrack();
    const tile = fakeTile({ watched: true, track });
    const { rerender } = renderWithKit(surface([tile]));
    expect(log).toEqual(['attach 0']);
    expect(track.attach.mock.calls[0][0]).toBe(document.querySelector('video'));
    rerender(surface([{ ...tile, speaking: true }]));
    rerender(surface([{ ...tile, speaking: false }, fakeTile({ id: 'u-pri:camera', identity: 'u-pri', name: 'pri', kind: 'camera' })]));
    expect(log).toEqual(['attach 0']);
  });

  it('Stop watching (the tile becomes unwatched) detaches from the same element', () => {
    const { track, log, elements } = fakeTrack();
    const tile = fakeTile({ watched: true, track });
    const { rerender } = renderWithKit(surface([tile]));
    const video = document.querySelector('video');
    rerender(surface([{ ...tile, watched: false, track: null }]));
    expect(log).toEqual(['attach 0', 'detach 0']);
    expect(elements[0]).toBe(video);
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByRole('button', { name: "Watch dropbear's screen" })).toBeInTheDocument();
  });

  it('the share ending while watched: the tile goes and the track is detached', () => {
    const { track } = fakeTrack();
    const tile = fakeTile({ watched: true, track });
    const { rerender } = renderWithKit(surface([tile]));
    rerender(surface([]));
    expect(screen.queryByRole('group', { name: "dropbear's screen" })).toBeNull();
    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(track.detach).toHaveBeenCalledTimes(1);
    expect(track.detach.mock.calls[0][0]).toBe(track.attach.mock.calls[0][0]);
  });

  it('the surface unmounting detaches every tile it showed', () => {
    const a = fakeTrack();
    const b = fakeTrack();
    const { unmount } = renderWithKit(
      surface([
        fakeTile({ watched: true, track: a.track }),
        fakeTile({ id: 'u-pri:camera', identity: 'u-pri', name: 'pri', kind: 'camera', watched: true, track: b.track }),
      ]),
    );
    unmount();
    expect(a.log).toEqual(['attach 0', 'detach 0']);
    expect(b.log).toEqual(['attach 0', 'detach 0']);
  });

  it('a new track for the same tile: the old one is detached before the new one attaches', () => {
    const order: string[] = [];
    const old = { attach: vi.fn((el: HTMLMediaElement) => (order.push('old attach'), el)), detach: vi.fn((el: HTMLMediaElement) => (order.push('old detach'), el)) };
    const next = { attach: vi.fn((el: HTMLMediaElement) => (order.push('new attach'), el)), detach: vi.fn((el: HTMLMediaElement) => (order.push('new detach'), el)) };
    const tile = fakeTile({ watched: true, track: old });
    const { rerender, unmount } = renderWithKit(surface([tile]));
    rerender(surface([{ ...tile, track: next }]));
    expect(order).toEqual(['old attach', 'old detach', 'new attach']);
    expect(old.detach.mock.calls[0][0]).toBe(old.attach.mock.calls[0][0]);
    unmount();
    expect(order).toEqual(['old attach', 'old detach', 'new attach', 'new detach']);
  });

  it('the track going (muted, or not yet subscribed): detached, and the label shows', () => {
    const { track, log } = fakeTrack();
    const tile = fakeTile({ watched: true, track });
    const { rerender } = renderWithKit(surface([tile]));
    rerender(surface([{ ...tile, track: null }]));
    expect(log).toEqual(['attach 0', 'detach 0']);
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByRole('group', { name: "dropbear's screen" })).toBeInTheDocument();
  });

  it('kind changing (a share replaced by a camera of the same person): the old tile detaches, the new one attaches', () => {
    const share = fakeTrack();
    const cam = fakeTrack();
    const { rerender } = renderWithKit(surface([fakeTile({ watched: true, track: share.track })]));
    rerender(
      surface([fakeTile({ id: 'u-drop:camera', kind: 'camera', watched: true, track: cam.track })]),
    );
    expect(share.log).toEqual(['attach 0', 'detach 0']);
    expect(cam.log).toEqual(['attach 0']);
    expect(screen.getByRole('group', { name: 'dropbear' })).toBeInTheDocument();
  });

  it('the same kind changing in place (screen to camera, same key): the element is kept, nothing re-attaches', () => {
    const { track, log } = fakeTrack();
    const tile = fakeTile({ watched: true, track });
    const { rerender } = renderWithKit(surface([tile]));
    rerender(surface([{ ...tile, kind: 'camera' }]));
    expect(log).toEqual(['attach 0']);
  });
});
