import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateToast } from '../../components/PWA/UpdateToast';
import {
  setUpdateSW,
  setUpdateAvailable,
  setUpdateDeferred,
  _resetSwUpdateForTests,
} from '../../utils/swUpdate';
import { renderInEveryTheme, withMatrixTheme } from '../test-utils/themeMatrix';

describe('UpdateToast', () => {
  beforeEach(() => {
    _resetSwUpdateForTests();
  });

  it('is hidden when no update is available', () => {
    render(<UpdateToast />);
    expect(screen.queryByText('Update available')).not.toBeInTheDocument();
  });

  it('appears when an update becomes available', () => {
    render(<UpdateToast />);
    act(() => setUpdateAvailable(true));

    expect(screen.getByText('Update available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('calls the update callback with reloadPage=true when Reload is clicked', async () => {
    const updateSW = vi.fn().mockResolvedValue(undefined);
    setUpdateSW(updateSW);

    render(<UpdateToast />);
    act(() => setUpdateAvailable(true));

    await userEvent.click(screen.getByRole('button', { name: /reload/i }));

    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('stays hidden while deferred (in a voice call) and reappears afterwards', () => {
    render(<UpdateToast />);

    act(() => {
      setUpdateAvailable(true);
      setUpdateDeferred(true);
    });
    expect(screen.queryByText('Update available')).not.toBeInTheDocument();

    // Leaving the call clears the deferral → the prompt reappears.
    act(() => setUpdateDeferred(false));
    expect(screen.getByText('Update available')).toBeInTheDocument();
  });

  describe('theme safety', () => {
    // Regression: dark + balanced/vibrant used a linear-gradient for
    // palette.background.default, and MUI SnackbarContent calls
    // emphasize(background.default) → "Unsupported `linear-gradient(...)` color".
    it.each([
      { mode: 'dark', intensity: 'balanced' },
      { mode: 'dark', intensity: 'vibrant' },
    ] as const)('renders the open toast under $mode + $intensity', (entry) => {
      act(() => setUpdateAvailable(true));
      render(withMatrixTheme(<UpdateToast />, entry));
      expect(screen.getByText('Update available')).toBeInTheDocument();
    });

    it('renders the open toast in every mode × intensity', () => {
      act(() => setUpdateAvailable(true));
      renderInEveryTheme(<UpdateToast />, () => {
        expect(screen.getByText('Update available')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
      });
    });
  });
});
