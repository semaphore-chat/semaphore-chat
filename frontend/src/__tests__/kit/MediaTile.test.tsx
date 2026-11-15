import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { MediaTile } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

/** What a callback ref was last called with (the first argument; React may pass more). */
const lastArg = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls[mock.mock.calls.length - 1]?.[0];

describe('MediaTile (K3)', () => {
  it('shows the label, as a group named by it', () => {
    renderWithKit(<MediaTile kind="camera" label="pri" />);
    expect(screen.getByRole('group', { name: 'pri' })).toBeInTheDocument();
    expect(screen.getByText('pri')).toBeInTheDocument();
  });

  it('an avatar tile shows a kit Avatar with the initials; the others do not', () => {
    const avatar = renderWithKit(<MediaTile kind="avatar" label="dropbear" />);
    expect(screen.getAllByText('DR').length).toBeGreaterThan(0);
    avatar.unmount();
    renderWithKit(<MediaTile kind="screen" label="dropbear's screen" />);
    expect(screen.queryByText('DR')).toBeNull();
  });

  it('hands the video element to the callback ref: muted, inline, aria-hidden', () => {
    const videoRef = vi.fn();
    const { container } = renderWithKit(<MediaTile kind="screen" label="aiko's screen" videoRef={videoRef} />);
    const video = container.querySelector('video');
    expect(videoRef).toHaveBeenCalledTimes(1);
    expect(lastArg(videoRef)).toBe(video);
    expect(video?.muted).toBe(true);
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('aria-hidden', 'true');
  });

  it('when the video element is replaced the callback gets null, then the new element', () => {
    const videoRef = vi.fn();
    const tree = (kind: 'camera' | 'avatar') => <MediaTile kind={kind} label="pri" videoRef={videoRef} />;
    const { rerender, container } = renderWithKit(tree('camera'));
    const first = container.querySelector('video');
    expect(lastArg(videoRef)).toBe(first);
    rerender(tree('avatar'));
    expect(lastArg(videoRef)).toBeNull();
    rerender(tree('camera'));
    const second = container.querySelector('video');
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(videoRef.mock.calls.map(([element]) => (element === null ? null : 'el'))).toEqual(['el', null, 'el']);
    expect(lastArg(videoRef)).toBe(second);
  });

  it('a new callback is told as well: the old one gets null, the new one the same element', () => {
    const one = vi.fn();
    const two = vi.fn();
    const { rerender, container } = renderWithKit(<MediaTile kind="camera" label="pri" videoRef={one} />);
    const video = container.querySelector('video');
    rerender(<MediaTile kind="camera" label="pri" videoRef={two} />);
    expect(lastArg(one)).toBeNull();
    expect(lastArg(two)).toBe(video);
  });

  it('without a callback, or for an avatar tile, there is no video element', () => {
    const none = renderWithKit(<MediaTile kind="camera" label="pri" />);
    expect(none.container.querySelector('video')).toBeNull();
    none.unmount();
    const videoRef = vi.fn();
    const avatar = renderWithKit(<MediaTile kind="avatar" label="pri" videoRef={videoRef} />);
    expect(avatar.container.querySelector('video')).toBeNull();
    expect(videoRef).not.toHaveBeenCalled();
  });

  it('a screen is shown whole (contain), a camera fills the box (cover)', () => {
    const screenTile = renderWithKit(<MediaTile kind="screen" label="s" videoRef={() => undefined} />);
    expect(getComputedStyle(screenTile.container.querySelector('video') as HTMLElement).objectFit).toBe('contain');
    screenTile.unmount();
    const camera = renderWithKit(<MediaTile kind="camera" label="c" videoRef={() => undefined} />);
    expect(getComputedStyle(camera.container.querySelector('video') as HTMLElement).objectFit).toBe('cover');
  });

  it('over video the label is a chip at the corner; without video it is centred', () => {
    const withVideo = renderWithKit(<MediaTile kind="camera" label="pri" videoRef={() => undefined} />);
    expect(getComputedStyle(screen.getByText('pri')).position).toBe('absolute');
    withVideo.unmount();
    renderWithKit(<MediaTile kind="camera" label="pri" />);
    expect(getComputedStyle(screen.getByText('pri')).position).not.toBe('absolute');
  });

  it('a blank label reads "Unknown user", and the caption is hidden from the tree (the group has the name)', () => {
    renderWithKit(<MediaTile kind="camera" label=" " videoRef={() => undefined} />);
    expect(screen.getByRole('group', { name: 'Unknown user' })).toBeInTheDocument();
    const named = renderWithKit(<MediaTile kind="camera" label="pri" videoRef={() => undefined} />);
    expect(named.getByText('pri')).toHaveAttribute('aria-hidden', 'true');
  });

  it('an avatar tile draws one avatar per size step; the container queries pick one (jsdom shows all)', () => {
    const { container } = renderWithKit(<MediaTile kind="avatar" label="dropbear" />);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText('DR')).toHaveLength(3);
  });

  it('steps down in a small tile: the container query rules are there, with widths from tokens', () => {
    const { container } = renderWithKit(<MediaTile kind="avatar" label="dropbear" />);
    const css = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('');
    // 16:9 tile that fits xl avatar + padding + gap + a meta line.
    const need = Math.ceil(((2 * tokens.space.md + tokens.avatar.xl + tokens.space.sm + tokens.text.meta.line) * 16) / 9);
    expect(css).toContain(`@container (max-width: ${need - 1}px)`);
    expect(container.firstElementChild && getComputedStyle(container.firstElementChild).containerType).toBe('inline-size');
  });

  it('speaking is in the name as well as the ring', () => {
    const quiet = renderWithKit(<MediaTile kind="camera" label="pri" />);
    expect(quiet.container.querySelector('[data-kit-speaking]')).toBeNull();
    quiet.unmount();
    const { container } = renderWithKit(<MediaTile kind="camera" label="pri" speaking />);
    expect(screen.getByRole('group', { name: 'pri, speaking' })).toBeInTheDocument();
    expect(container.querySelector('[data-kit-speaking]')).not.toBeNull();
  });

  it('is 16:9 with the card radius from tokens', () => {
    renderWithKit(<MediaTile kind="avatar" label="pri" />);
    const style = getComputedStyle(screen.getByRole('group', { name: 'pri' }));
    expect(style.aspectRatio.replace(/\s/g, '')).toBe('16/9');
    expect(style.borderRadius).toBe(`${tokens.radius.card}px`);
  });
});
