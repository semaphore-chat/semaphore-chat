import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { AttachmentTile, MessageRow } from '../../kit';
import { IMAGE_FALLBACK, IMAGE_MAX, imageBox } from '../../kit/chat/AttachmentTile';
import { renderWithKit } from '../test-utils/renderWithKit';

describe('imageBox', () => {
  it('keeps a small image at its own size', () => {
    expect(imageBox(200, 100)).toEqual({ width: 200, height: 100 });
  });
  it('shrinks a wide or tall image to fit, keeping its shape', () => {
    expect(imageBox(1600, 900)).toEqual({ width: 320, height: 180 });
    expect(imageBox(600, 1200)).toEqual({ width: 120, height: 240 });
    const { width, height } = imageBox(5000, 5000);
    expect(width).toBeLessThanOrEqual(IMAGE_MAX.width);
    expect(height).toBeLessThanOrEqual(IMAGE_MAX.height);
  });
  it('uses the fallback box when the size is unknown or nonsense', () => {
    expect(imageBox(null, null)).toEqual(IMAGE_FALLBACK);
    expect(imageBox(0, 100)).toEqual(IMAGE_FALLBACK);
    expect(imageBox(Number.NaN, 100)).toEqual(IMAGE_FALLBACK);
  });
});

describe('AttachmentTile', () => {
  it('an image is a button that opens it, its box sized before the picture arrives', () => {
    const onOpen = vi.fn();
    renderWithKit(<AttachmentTile kind="image" name="sunset.png" width={1600} height={900} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'Open image sunset.png' });
    expect(button.querySelector('img')).toBeNull();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('draws the picture lazily once it is known, and the name when it cannot be drawn', () => {
    const { rerender } = renderWithKit(<AttachmentTile kind="image" name="a.png" src="blob:x" width={10} height={10} onOpen={() => undefined} />);
    const img = screen.getByRole('button').querySelector('img')!;
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('alt', '');
    fireEvent.error(img);
    rerender(<AttachmentTile kind="image" name="a.png" src="blob:x" width={10} height={10} onOpen={() => undefined} />);
    expect(screen.getByText('a.png')).toBeInTheDocument();
  });

  it('a file is a download button named with its size; busy ignores presses', () => {
    const onOpen = vi.fn();
    const { rerender } = renderWithKit(<AttachmentTile kind="file" name="notes.txt" detail="2.1 KB" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download notes.txt, 2.1 KB' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    rerender(<AttachmentTile kind="file" name="notes.txt" detail="2.1 KB" onOpen={onOpen} busy />);
    const button = screen.getByRole('button', { name: 'Download notes.txt, 2.1 KB' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('is out of the Tab order in a row Tab skips', () => {
    renderWithKit(
      <MessageRow
        author="aiko"
        time="8:19 PM"
        focus={{ tabStop: false }}
        attachments={<AttachmentTile kind="file" name="n.txt" onOpen={() => undefined} />}
      />,
    );
    expect(screen.getByRole('button', { name: 'Download n.txt' })).toHaveAttribute('tabindex', '-1');
  });
});
