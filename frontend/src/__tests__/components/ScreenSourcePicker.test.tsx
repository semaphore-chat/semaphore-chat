import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { ScreenSourcePicker } from '../../components/Voice/ScreenSourcePicker';
import type { DesktopSource } from '../../types/electron-api';
import { renderWithProviders } from '../test-utils';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';

vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sources: DesktopSource[] = [
  { id: 'screen:0:0', name: 'Entire Screen', thumbnail: 'data:image/png;base64,' },
  { id: 'window:42:0', name: 'Text Editor', thumbnail: 'data:image/png;base64,' },
];

describe('ScreenSourcePicker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('lists the desktop sources from the Electron bridge and returns the chosen one', async () => {
    const getDesktopSources = vi.fn().mockResolvedValue(sources);
    const onSelect = vi.fn();
    const { user } = renderWithProviders(
      <ScreenSourcePicker open onClose={() => {}} onSelect={onSelect} />,
      { electronAPI: createFakeElectronAPI({ platform: 'win32', getDesktopSources }) },
    );

    await user.click(await screen.findByAltText('Text Editor'));
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(getDesktopSources).toHaveBeenCalledWith(['screen', 'window']);
    expect(screen.getByText('Entire Screens')).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith('window:42:0', expect.objectContaining({ enableAudio: true }));
  });

  it('turns system audio off on Linux, where it cannot be captured', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(
      <ScreenSourcePicker open onClose={() => {}} onSelect={onSelect} />,
      { electronAPI: createFakeElectronAPI({ platform: 'linux', getDesktopSources: () => Promise.resolve(sources) }) },
    );

    await user.click(await screen.findByAltText('Entire Screen'));
    expect(screen.getByLabelText('System Audio')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(onSelect).toHaveBeenCalledWith('screen:0:0', expect.objectContaining({ enableAudio: false }));
  });

  it('explains that screen capture needs the desktop app outside Electron', async () => {
    renderWithProviders(<ScreenSourcePicker open onClose={() => {}} onSelect={() => {}} />, {
      electronAPI: null,
    });

    expect(await screen.findByText('Screen capture is only available in the desktop app')).toBeInTheDocument();
  });

  it('says so when there is nothing to share', async () => {
    renderWithProviders(<ScreenSourcePicker open onClose={() => {}} onSelect={() => {}} />, {
      electronAPI: createFakeElectronAPI(),
    });

    expect(await screen.findByText('No screens or windows available to share')).toBeInTheDocument();
  });
});
