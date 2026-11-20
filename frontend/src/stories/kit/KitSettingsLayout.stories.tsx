import { useState, type JSX } from 'react';
import { AppFrame, SettingsLayout, type SettingsLayoutProps } from '../../kit';
import type { ModeName } from '../../theme/derive/derivePalette';
import { KitFrameStage } from '../fixtures/kitStory';
import { SampleRoleForm, SampleSections, SampleUnsaved } from '../fixtures/layoutSamples';

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
