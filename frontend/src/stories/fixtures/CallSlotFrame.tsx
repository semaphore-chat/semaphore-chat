/**
 * The frame the call slot stories render in: the real AppFrame and ThreeIslands template with the sample
 * dock, channels and conversation, and the story's content in the call slot, so the shot shows where the bar
 * sits at each width (phone: between the pane and the dock; compact and wide: the foot of the left column).
 */
import type { JSX, ReactNode } from 'react';
import { AppFrame, ThreeIslands, useWidthRange, type WidthRange } from '../../kit';
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
  children,
}: {
  mode?: ModeName;
  /** The on-screen keyboard is up (faked): the frame ends at it and the dock bar goes. */
  keyboard?: boolean;
  children: (width: WidthRange) => ReactNode;
}): JSX.Element {
  const frame = (
    <KitFrameStage mode={mode}>
      <AppFrame>
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
