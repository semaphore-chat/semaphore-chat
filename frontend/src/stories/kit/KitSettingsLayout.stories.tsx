import { useState, type JSX } from 'react';
import { AppFrame, SettingsLayout, type SettingsLayoutProps } from '../../kit';
import type { ModeName } from '../../theme/derive/derivePalette';
import { KitFrameStage } from '../fixtures/kitStory';
import { SampleCallBar, SampleDock, SampleRoleForm, SampleSections, SampleUnsaved } from '../fixtures/layoutSamples';

/**
 * The settings screen's layout: the sections beside the section being edited, with the unsaved-changes bar
 * pinned under it. On a phone one pane at a time, with Back on the content pane.
 */
function Screen({ mode, phonePane = 'nav', ...props }: { mode: ModeName } & Partial<SettingsLayoutProps>): JSX.Element {
  const [pane, setPane] = useState<'nav' | 'content'>(phonePane);
  return (
    <KitFrameStage mode={mode}>
      <AppFrame>
        <SettingsLayout
          title="Community settings"
          nav={<SampleSections onPick={() => setPane('content')} />}
          navLabel="Community settings sections"
          footer={<SampleUnsaved />}
          phonePane={pane}
          onBack={() => setPane('nav')}
          {...props}
        >
          <SampleRoleForm />
        </SettingsLayout>
      </AppFrame>
    </KitFrameStage>
  );
}

export const Community = () => <Screen mode="dark" phonePane="content" />;

/** A phone on the list of sections. At compact and wide it is the same as Community. */
export const PhoneNav = () => <Screen mode="dark" phonePane="nav" />;

/** A phone on one section, with Back. At compact and wide it is the same as Community. */
export const PhoneContent = () => <Screen mode="dark" phonePane="content" />;

export const CommunityLight = () => <Screen mode="light" phonePane="content" />;

/** No footer: the content island is only its section, with no bar under it. */
export const NoFooter = () => <Screen mode="dark" phonePane="content" footer={undefined} />;

/**
 * With the shell's pieces, as the Lounge's settings template uses them: the dock above the sections, the call bar
 * under them at compact and wide; on a phone the section, then the call bar, then the dock bar.
 */
export const WithDockAndCall = () => <Screen mode="dark" phonePane="content" dock={<SampleDock />} callBar={<SampleCallBar />} />;

/** The same on a phone's list of sections. */
export const WithDockAndCallPhoneNav = () => <Screen mode="dark" phonePane="nav" dock={<SampleDock />} callBar={<SampleCallBar />} />;
WithDockAndCallPhoneNav.meta = { viewports: ['phone'] };
