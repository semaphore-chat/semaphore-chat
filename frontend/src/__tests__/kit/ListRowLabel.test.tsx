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

  it('names a link', () => {
    renderWithKit(<ListRow primary="general" label="Go to general" href="#general" />);
    expect(screen.getByRole('link', { name: 'Go to general' })).toHaveAttribute('href', '#general');
  });

  it('is ignored on a plain row (nothing to name)', () => {
    const { container } = renderWithKit(<ListRow primary="Squad Up" label="Open call view, Squad Up" />);
    expect(container.querySelector('[aria-label]')).toBeNull();
  });
});
