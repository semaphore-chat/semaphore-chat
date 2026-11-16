/**
 * The frame the call slot stories render in: the real AppFrame and ThreeIslands template with the sample
 * dock, channels and conversation, and the story's content in the call slot, so the shot shows where the bar
 * sits at each width (phone: between the pane and the dock; compact and wide: the foot of the left column).
 */
import type { JSX, ReactNode } from 'react';
import { AppFrame, ThreeIslands, useWidthRange, type WidthRange } from '../../kit';
import { ShellBanners } from '../../shell/lounge/pieces/ShellBanners';
import { NO_BANNERS } from '../../shell/lounge/pieces/shellBannersModel';
import type { ModeName } from '../../theme/derive/derivePalette';
import { KitFrameStage } from './kitStory';
import { FakeKeyboard } from './fakeKeyboard';
import { SampleChannels, SampleConversation, SampleDock } from './layoutSamples';

function Slot({ children }: { children: (width: WidthRange) => ReactNode }): JSX.Element {
  return <>{children(useWidthRange())}</>;
}

export function CallSlotFrame({
  mode = 'dark',
  keyboard = false,
  banners = 0,
  children,
}: {
  mode?: ModeName;
  /** The on-screen keyboard is up (faked): the frame ends at it and the dock bar goes. */
  keyboard?: boolean;
  /**
   * App banners pending above the layout, through the shell's own banner row (its cap applies: two on a phone,
   * one on one line while the keyboard is up): the connection problem, then a web update.
   */
  banners?: 0 | 1 | 2;
  children: (width: WidthRange) => ReactNode;
}): JSX.Element {
  const frame = (
    <KitFrameStage mode={mode}>
      <AppFrame
        banner={
          banners > 0 ? (
            <ShellBanners
              {...NO_BANNERS}
              connection="unreachable"
              webUpdate={banners > 1 ? { onReload: () => undefined } : null}
            />
          ) : undefined
        }
      >
        <ThreeIslands
          dock={<SampleDock />}
          left={<SampleChannels />}
          leftLabel="Couch Co-op"
          centre={<SampleConversation />}
          centreLabel="general"
          callBar={<Slot>{children}</Slot>}
        />
      </AppFrame>
    </KitFrameStage>
  );
  return keyboard ? <FakeKeyboard>{frame}</FakeKeyboard> : frame;
}
