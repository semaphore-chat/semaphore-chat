import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders, runAxe, expectNoAxeViolations } from '../test-utils';
import { ShortcutSheet } from '../../components/Shortcuts/ShortcutSheet';

describe('ShortcutSheet', () => {
  it('lists every shortcut by group with Ctrl key caps off Mac', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(<ShortcutSheet open onClose={onClose} mac={false} />);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const group of ['Navigation', 'Messages', 'Help']) {
      expect(within(dialog).getByRole('heading', { name: group })).toBeInTheDocument();
    }
    expect(within(dialog).getByLabelText('Alt plus Shift plus Down arrow')).toHaveTextContent('AltShift↓');
    expect(within(dialog).getByLabelText('Control plus Slash')).toHaveTextContent('Ctrl/');
    expect(dialog).not.toHaveTextContent(/switcher|Ctrl\s*K/i);

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows Mac key caps on macOS', () => {
    renderWithProviders(<ShortcutSheet open onClose={vi.fn()} mac />);
    expect(screen.getByLabelText('Command plus Slash')).toHaveTextContent('⌘/');
    expect(screen.getByLabelText('Option plus Up arrow')).toHaveTextContent('⌥↑');
  });

  it('has no axe violations', async () => {
    renderWithProviders(<ShortcutSheet open onClose={vi.fn()} mac={false} />);
    expectNoAxeViolations(await runAxe(screen.getByRole('dialog')));
  });
});
