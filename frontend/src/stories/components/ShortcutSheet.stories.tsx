import { ShortcutSheet } from '../../components/Shortcuts/ShortcutSheet';
import { defineComponent } from '../fixtures/componentStory';
import { asElectron } from '../fixtures/electron';
import { bigCommunityScenario } from '../fixtures/scenarios';

/*
 * The keyboard shortcut sheet (Ctrl+/ or ⌘/, or "Keyboard shortcuts" in the
 * desktop account menu). A centered dialog on desktop; full screen below the
 * phone breakpoint (the shortcuts only run in the desktop layout, but the
 * sheet must still fit a narrow window).
 */

/** Windows / Linux key caps. */
export const WindowsLinux = defineComponent(
  bigCommunityScenario,
  () => <ShortcutSheet open mac={false} onClose={() => {}} />,
  { maxWidth: false },
);

/** macOS key caps (⌘ ⌥ ⇧). */
export const Mac = defineComponent(bigCommunityScenario, () => <ShortcutSheet open mac onClose={() => {}} />, {
  maxWidth: false,
});
Mac.meta = { viewports: ['desktop'] };

/** The desktop app on macOS: the platform comes from Electron, not a prop. */
export const ElectronMac = asElectron(
  defineComponent(bigCommunityScenario, () => <ShortcutSheet open onClose={() => {}} />, { maxWidth: false }),
  { platform: 'darwin' },
);
ElectronMac.meta = { viewports: ['desktop'] };
