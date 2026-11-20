/** ListRow `label`: the accessible name of a pressable row whose visible lines do not say what it does. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { IconButton, ListRow } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

describe('ListRow label', () => {
  it('names the button; the trailing control keeps its own name and press', () => {
    const open = vi.fn();
    const leave = vi.fn();
    renderWithKit(
      <ListRow
        primary="Squad Up"
        secondary="Voice connected"
        label="Open call view, Squad Up"
        onClick={open}
        trailing={<IconButton icon="PhoneOff" label="Leave call" onClick={leave} />}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open call view, Squad Up' }));
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    expect(leave).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('with a label, the secondary line describes the button (it is no longer in the name)', () => {
    renderWithKit(<ListRow primary="Squad Up" secondary="Muted" label="Open call view, Squad Up" onClick={() => {}} />);
    const button = screen.getByRole('button', { name: 'Open call view, Squad Up' });
    expect(button).toHaveAccessibleDescription('Muted');
  });

  it('without a label nothing is described twice (the line is in the name already)', () => {
    renderWithKit(<ListRow primary="Squad Up" secondary="Muted" onClick={() => {}} />);
    const button = screen.getByRole('button', { name: 'Squad Up Muted' });
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('chevron: drawn inside the link or button, hidden from the accessibility tree; not on a plain row', () => {
    const { container, rerender } = renderWithKit(<ListRow primary="Squad Up" chevron onClick={() => {}} />);
    const button = screen.getByRole('button', { name: 'Squad Up' });
    expect(button.querySelectorAll('svg')).toHaveLength(1);
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<ListRow primary="Squad Up" chevron />);
    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });

  it('one naming rule: label replaces the visible lines, unread and trailingLabel are appended, secondary describes', () => {
    renderWithKit(
      <ListRow primary="clips" secondary="Muted" unread trailingLabel="2 mentions" label="Open clips" onClick={() => {}} />,
    );
    const button = screen.getByRole('button', { name: 'Open clips, unread, 2 mentions' });
    expect(button).toHaveAccessibleDescription('Muted');
  });

  it('strong: bold like unread, nothing added to the name', () => {
    renderWithKit(<ListRow primary="Squad Up" strong label="Open call view, Squad Up" onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Open call view, Squad Up' })).toBeInTheDocument();
  });

  it('names a link', () => {
    renderWithKit(<ListRow primary="general" label="Go to general" href="#general" />);
    expect(screen.getByRole('link', { name: 'Go to general' })).toHaveAttribute('href', '#general');
  });

  it('is ignored on a plain row (nothing to name)', () => {
    const { container } = renderWithKit(<ListRow primary="Squad Up" label="Open call view, Squad Up" />);
    expect(container.querySelector('[aria-label]')).toBeNull();
  });
});
