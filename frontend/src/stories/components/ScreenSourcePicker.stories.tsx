import type { ReactNode } from 'react';
import { ScreenSourcePicker } from '../../components/Voice/ScreenSourcePicker';
import { defineComponent } from '../fixtures/componentStory';
import { FAKE_DESKTOP_SOURCES } from '../fixtures/desktopSources';
import { asElectron } from '../fixtures/electron';
import { ClickOnMount } from '../fixtures/interactions';
import { bigCommunityScenario } from '../fixtures/scenarios';

/*
 * The Electron screen-share picker (opened from the voice bar's share button
 * outside Wayland), listing the fake bridge's desktop sources: two screens
 * and four windows with generated thumbnails. Electron windows are at least
 * 800px wide, so tablet and desktop only.
 */

const picker = (overlay?: ReactNode) =>
  defineComponent(
    bigCommunityScenario,
    () => (
      <>
        <ScreenSourcePicker open onClose={() => {}} onSelect={() => {}} />
        {overlay}
      </>
    ),
    { maxWidth: false },
  );

const getDesktopSources = () => Promise.resolve(FAKE_DESKTOP_SOURCES);

/** Linux: system audio can't be captured, so the audio switch is off and disabled. */
export const Sources = asElectron(picker(), { getDesktopSources });
Sources.meta = { viewports: ['tablet', 'desktop'] };

const vsCodeTile = () => document.querySelector<HTMLElement>('img[alt="Visual Studio Code"]');

/** Windows, with a window selected: system audio is available and on. */
export const WindowSelected = asElectron(picker(<ClickOnMount find={vsCodeTile} />), {
  platform: 'win32',
  getDesktopSources,
});
WindowSelected.meta = { viewports: ['tablet', 'desktop'] };

/** Nothing to share (every source was filtered out or capture was denied). */
export const NoSources = asElectron(picker(), { getDesktopSources: () => Promise.resolve([]) });
NoSources.meta = { viewports: ['tablet', 'desktop'] };
