import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { AttachmentTile, LinkCard, MediaViewer, MessageRow, ReactionChip } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

describe('LinkCard', () => {
  it('is one link to the page, opened in a new tab without the opener or a Referer', () => {
    renderWithKit(
      <LinkCard href="https://example.com/a" title="An article" site="Example" description="Words" imageSrc="https://cdn.example.com/b.jpg" iconSrc="https://example.com/f.ico" />,
    );
    const link = screen.getByRole('link', { name: 'An article, Example, opens in a new tab' });
    expect(link).toHaveAttribute('href', 'https://example.com/a');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    const images = Array.from(link.querySelectorAll('img'));
    expect(images.map((img) => img.getAttribute('src'))).toEqual(['https://example.com/f.ico', 'https://cdn.example.com/b.jpg']);
    for (const img of images) expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(images[1]).toHaveAttribute('loading', 'lazy');
  });

  it('a card without a title is named by its site', () => {
    renderWithKit(<LinkCard href="https://example.com/" site="example.com" />);
    expect(screen.getByRole('link', { name: 'example.com, opens in a new tab' })).toBeInTheDocument();
  });

  it('an address the kit will not open (a scheme other than http(s), a user name) is drawn, not linked', () => {
    renderWithKit(
      <>
        <LinkCard href="javascript:alert(1)" title="Bad" site="x" />
        <LinkCard href="https://bank.example@evil.example/" title="Tricky" site="bank.example" />
      </>,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Bad' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tricky' })).toBeInTheDocument();
  });

  it('a banner that fails leaves its box (the card keeps its height); a failed icon becomes the link icon', () => {
    const { container } = renderWithKit(
      <LinkCard href="https://example.com/a" title="T" site="S" imageSrc="https://x/b.jpg" iconSrc="https://x/f.ico" />,
    );
    const [icon, banner] = Array.from(container.querySelectorAll('img'));
    const box = banner.parentElement as HTMLElement;
    fireEvent.error(banner);
    fireEvent.error(icon);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(box.isConnected).toBe(true);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('AttachmentTile: video, audio and remote pictures', () => {
  it('a video is Play over its still; nothing plays until pressed; given its address it is the player', () => {
    const onOpen = vi.fn();
    const { rerender } = renderWithKit(
      <AttachmentTile kind="video" name="clip.mp4" detail="4 MB" poster="blob:poster" width={1920} height={1080} onOpen={onOpen} />,
    );
    expect(document.querySelector('video')).toBeNull();
    const play = screen.getByRole('button', { name: 'Play video clip.mp4, 4 MB' });
    expect(play.querySelector('img')).toHaveAttribute('src', 'blob:poster');
    fireEvent.click(play);
    expect(onOpen).toHaveBeenCalledTimes(1);
    rerender(<AttachmentTile kind="video" name="clip.mp4" detail="4 MB" poster="blob:poster" src="https://app/f/1" width={1920} height={1080} onOpen={onOpen} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video).toHaveAttribute('src', 'https://app/f/1');
    expect(video).toHaveAttribute('controls');
    expect(video.autoplay).toBe(true);
    expect(video).toHaveAttribute('aria-label', 'clip.mp4');
  });

  it('a busy video keeps its Play button focusable and ignores presses', () => {
    const onOpen = vi.fn();
    renderWithKit(<AttachmentTile kind="video" name="clip.mp4" onOpen={onOpen} busy />);
    const play = screen.getByRole('button', { name: 'Play video clip.mp4' });
    expect(play).toHaveAttribute('aria-busy', 'true');
    expect(play).not.toBeDisabled();
    fireEvent.click(play);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('audio is a row with Play; given its address it shows its name over the player', () => {
    const onOpen = vi.fn();
    const { rerender } = renderWithKit(<AttachmentTile kind="audio" name="song.ogg" detail="3 MB" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play audio song.ogg, 3 MB' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(document.querySelector('audio')).toBeNull();
    rerender(<AttachmentTile kind="audio" name="song.ogg" detail="3 MB" src="blob:song" onOpen={onOpen} />);
    expect(screen.getByRole('group', { name: 'song.ogg, 3 MB' })).toBeInTheDocument();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    expect(audio).toHaveAttribute('src', 'blob:song');
    expect(audio.autoplay).toBe(true);
  });

  it('a remote picture loads without a Referer; an own picture is left as it was', () => {
    const { container } = renderWithKit(
      <>
        <AttachmentTile kind="image" name="GIF" src="https://media.giphy.com/a.gif" remote onOpen={() => {}} />
        <AttachmentTile kind="image" name="own.png" src="blob:own" onOpen={() => {}} />
      </>,
    );
    const [remote, own] = Array.from(container.querySelectorAll('img'));
    expect(remote).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(own).not.toHaveAttribute('referrerpolicy');
  });

  it('a picture that cannot be drawn tells the screen', () => {
    const onLoadError = vi.fn();
    const { container } = renderWithKit(<AttachmentTile kind="image" name="GIF" src="https://x/a.gif" remote onOpen={() => {}} onLoadError={onLoadError} />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(onLoadError).toHaveBeenCalledTimes(1);
  });
});

describe('ReactionChip: who reacted', () => {
  it('a right-click shows the people, does not toggle, and is not the row\'s (its actions stay shut)', () => {
    const onToggle = vi.fn();
    const onShowPeople = vi.fn();
    const onOpenActions = vi.fn();
    renderWithKit(
      <MessageRow
        author="aiko"
        time="8:00 PM"
        onOpenActions={onOpenActions}
        reactions={<ReactionChip emoji="😂" label="Laugh" count={3} onToggle={onToggle} onShowPeople={onShowPeople} />}
      />,
    );
    const chip = screen.getByRole('button', { name: 'Laugh reaction, 3' });
    fireEvent.pointerDown(chip, { pointerType: 'mouse', button: 2 });
    const event = fireEvent.contextMenu(chip);
    expect(event).toBe(false);
    expect(onShowPeople).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
    expect(onOpenActions).not.toHaveBeenCalled();
  });

  it('the context-menu key (a context menu with no pointer) shows them; twice in a row shows them twice', () => {
    vi.useFakeTimers();
    try {
      const onShowPeople = vi.fn();
      renderWithKit(<ReactionChip emoji="😂" label="Laugh" count={3} onToggle={() => {}} onShowPeople={onShowPeople} />);
      const chip = screen.getByRole('button', { name: 'Laugh reaction, 3' });
      fireEvent.contextMenu(chip);
      act(() => vi.advanceTimersByTime(2000));
      fireEvent.contextMenu(chip);
      expect(onShowPeople).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a touch long press shows them once (the context menu Android adds is the same press) and its click does not toggle', () => {
    vi.useFakeTimers();
    try {
      const onToggle = vi.fn();
      const onShowPeople = vi.fn();
      renderWithKit(<ReactionChip emoji="😂" label="Laugh" count={3} onToggle={onToggle} onShowPeople={onShowPeople} />);
      const chip = screen.getByRole('button', { name: 'Laugh reaction, 3' });
      fireEvent.pointerDown(chip, { pointerType: 'touch', clientX: 10, clientY: 10 });
      act(() => vi.advanceTimersByTime(500));
      expect(onShowPeople).toHaveBeenCalledTimes(1);
      fireEvent.contextMenu(chip);
      fireEvent.pointerUp(chip, { pointerType: 'touch' });
      fireEvent.click(chip);
      expect(onShowPeople).toHaveBeenCalledTimes(1);
      expect(onToggle).not.toHaveBeenCalled();
      // The next plain tap toggles again.
      fireEvent.pointerDown(chip, { pointerType: 'touch', clientX: 10, clientY: 10 });
      fireEvent.pointerUp(chip, { pointerType: 'touch' });
      fireEvent.click(chip);
      expect(onToggle).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a finger that moves is scrolling: no people', () => {
    vi.useFakeTimers();
    try {
      const onShowPeople = vi.fn();
      renderWithKit(<ReactionChip emoji="😂" label="Laugh" count={3} onToggle={() => {}} onShowPeople={onShowPeople} />);
      const chip = screen.getByRole('button', { name: 'Laugh reaction, 3' });
      fireEvent.pointerDown(chip, { pointerType: 'touch', clientX: 10, clientY: 10 });
      fireEvent.pointerMove(chip, { pointerType: 'touch', clientX: 10, clientY: 40 });
      act(() => vi.advanceTimersByTime(600));
      expect(onShowPeople).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('works on a read-only chip; without onShowPeople a right-click is left to the row', () => {
    const onShowPeople = vi.fn();
    const onOpenActions = vi.fn();
    renderWithKit(
      <MessageRow
        author="aiko"
        time="8:00 PM"
        onOpenActions={onOpenActions}
        reactions={
          <>
            <ReactionChip emoji="😂" label="Laugh" count={3} onToggle={() => {}} aria-disabled onShowPeople={onShowPeople} />
            <ReactionChip emoji="🔥" label="Fire" count={1} onToggle={() => {}} />
          </>
        }
      />,
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Laugh reaction, 3' }));
    expect(onShowPeople).toHaveBeenCalledTimes(1);
    const fire = screen.getByRole('button', { name: 'Fire reaction, 1' });
    fireEvent.pointerDown(fire, { pointerType: 'mouse', button: 2 });
    fireEvent.contextMenu(fire);
    expect(onOpenActions).toHaveBeenCalledTimes(1);
  });
});

function Viewer({ onClose = () => {}, onDownload }: { onClose?: (r: string) => void; onDownload?: () => void }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <MediaViewer
        open={open}
        onClose={(reason) => {
          onClose(reason);
          setOpen(false);
        }}
        items={[{ src: 'blob:1', name: 'one.png' }, { name: 'two.png' }, { src: 'blob:3', name: 'three.png', alt: 'A cat' }]}
        index={index}
        onIndexChange={setIndex}
        onDownload={onDownload}
      />
    </>
  );
}

describe('MediaViewer', () => {
  it('opens on Close, named by the picture, "1 of 3"; arrows and buttons step; Escape closes and focus returns', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Viewer onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    const dialog = screen.getByRole('dialog', { name: 'one.png' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' })));
    expect(dialog).toHaveTextContent('1 of 3');
    expect(screen.getByRole('img', { name: 'one.png' })).toHaveAttribute('src', 'blob:1');
    expect(screen.getByRole('button', { name: 'Previous picture' })).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog', { name: 'two.png' })).toHaveTextContent('2 of 3');
    expect(screen.getByRole('status', { name: 'Loading two.png' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next picture' }));
    expect(screen.getByRole('img', { name: 'A cat' })).toBeInTheDocument();
    // At the end Next stays where focus is, unavailable.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next picture' }));
    expect(screen.getByRole('button', { name: 'Next picture' })).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog', { name: 'three.png' })).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('dialog', { name: 'two.png' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith('escape');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'open' }));
  });

  it('Close says button; Download is offered only when given; a broken picture says so', async () => {
    const onClose = vi.fn();
    const onDownload = vi.fn();
    const { user } = renderWithKit(<Viewer onClose={onClose} onDownload={onDownload} />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    fireEvent.error(screen.getByRole('img', { name: 'one.png' }));
    expect(screen.getByText("Couldn't load the picture")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download one.png' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledWith('button');
  });

  it('a sideways swipe steps; a mostly vertical one does not', async () => {
    const { user } = renderWithKit(<Viewer />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    const stage = screen.getByRole('img', { name: 'one.png' }).parentElement as HTMLElement;
    fireEvent.pointerDown(stage, { pointerType: 'touch', clientX: 300, clientY: 400 });
    fireEvent.pointerUp(stage, { pointerType: 'touch', clientX: 280, clientY: 200 });
    expect(screen.getByRole('dialog', { name: 'one.png' })).toBeInTheDocument();
    fireEvent.pointerDown(stage, { pointerType: 'touch', clientX: 300, clientY: 400 });
    fireEvent.pointerUp(stage, { pointerType: 'touch', clientX: 200, clientY: 410 });
    expect(screen.getByRole('dialog', { name: 'two.png' })).toBeInTheDocument();
  });
});
