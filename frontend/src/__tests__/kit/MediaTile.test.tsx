import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { MediaTile } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('MediaTile (K3)', () => {
  it('shows the label, as a group named by it', () => {
    renderWithKit(<MediaTile kind="camera" label="pri" />);
    expect(screen.getByRole('group', { name: 'pri' })).toBeInTheDocument();
    expect(screen.getByText('pri')).toBeInTheDocument();
  });

  it('an avatar tile shows a kit Avatar with the initials; the others do not', () => {
    const avatar = renderWithKit(<MediaTile kind="avatar" label="dropbear" />);
    expect(screen.getByText('DR')).toBeInTheDocument();
    avatar.unmount();
    renderWithKit(<MediaTile kind="screen" label="dropbear's screen" />);
    expect(screen.queryByText('DR')).toBeNull();
  });

  it('attaches the video element through videoRef: a muted, inline, playing video the caller can set a stream on', () => {
    const ref = createRef<HTMLVideoElement>();
    const { container } = renderWithKit(<MediaTile kind="screen" label="aiko's screen" videoRef={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLVideoElement);
    expect(container.querySelectorAll('video')).toHaveLength(1);
    expect(ref.current?.muted).toBe(true);
    expect(ref.current).toHaveAttribute('playsinline');
    // The label is the group's name; the picture adds nothing for a screen reader.
    expect(ref.current).toHaveAttribute('aria-hidden', 'true');
  });

  it('has no video element without videoRef, and none for an avatar tile', () => {
    const none = renderWithKit(<MediaTile kind="camera" label="pri" />);
    expect(none.container.querySelector('video')).toBeNull();
    none.unmount();
    const ref = createRef<HTMLVideoElement>();
    const avatar = renderWithKit(<MediaTile kind="avatar" label="pri" videoRef={ref} />);
    expect(avatar.container.querySelector('video')).toBeNull();
    expect(ref.current).toBeNull();
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
    expect(style.borderRadius).toBe('18px');
  });
});
