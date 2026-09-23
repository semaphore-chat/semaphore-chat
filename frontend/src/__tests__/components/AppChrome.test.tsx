import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { setUpdateAvailable, _resetSwUpdateForTests } from '../../utils/swUpdate';
import { THEME_MATRIX, themeLabel, withMatrixTheme } from '../test-utils/themeMatrix';

const { crash } = vi.hoisted(() => ({ crash: { updateToast: false } }));

// Let individual tests make UpdateToast throw while rendering.
vi.mock('../../components/PWA/UpdateToast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/PWA/UpdateToast')>();
  const Wrapped = () => {
    if (crash.updateToast) throw new Error('toast exploded');
    return <actual.UpdateToast />;
  };
  return { ...actual, UpdateToast: Wrapped, default: Wrapped };
});

import { AppChrome } from '../../components/PWA/AppChrome';

describe('AppChrome', () => {
  beforeEach(() => {
    _resetSwUpdateForTests();
    crash.updateToast = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the update toast when an update is available', () => {
    act(() => setUpdateAvailable(true));
    render(withMatrixTheme(<AppChrome />, { mode: 'dark', intensity: 'balanced' }));
    expect(screen.getByText('Update available')).toBeInTheDocument();
  });

  it('contains a render error inside a toast without blanking the app', () => {
    crash.updateToast = true;
    act(() => setUpdateAvailable(true));
    render(
      <ErrorBoundary fallback={() => <div>APP CRASHED</div>}>
        <AppChrome />
        <main>app content</main>
      </ErrorBoundary>,
    );
    expect(screen.getByText('app content')).toBeInTheDocument();
    expect(screen.queryByText('APP CRASHED')).not.toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Update available')).not.toBeInTheDocument();
  });

  it('renders with an update pending in every mode × intensity without reaching the app boundary', () => {
    act(() => setUpdateAvailable(true));
    for (const entry of THEME_MATRIX) {
      const { unmount } = render(
        withMatrixTheme(
          <ErrorBoundary fallback={() => <div>APP CRASHED</div>}>
            <AppChrome />
          </ErrorBoundary>,
          entry,
        ),
      );
      expect(screen.queryByText('APP CRASHED'), themeLabel(entry)).not.toBeInTheDocument();
      expect(screen.getByText('Update available'), themeLabel(entry)).toBeInTheDocument();
      unmount();
    }
  });
});
