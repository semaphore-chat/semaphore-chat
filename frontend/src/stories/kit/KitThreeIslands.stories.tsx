import { useState, type JSX } from 'react';
import { AppFrame, ThreeIslands, useWidthRange, type ThreeIslandsProps } from '../../kit';
import type { ModeName } from '../../theme/derive/derivePalette';
import { KitFrameStage } from '../fixtures/kitStory';
import {
  SampleCallBar,
  SampleChannels,
  SampleConversation,
  SampleDock,
  SampleMembers,
} from '../fixtures/layoutSamples';

/**
 * The chat screen's layout, wired the way a real screen is. Wide: the dock above the channels | the conversation |
 * the members. Compact: the members are a Sheet. Phone: one pane with the dock as the bar under it; picking a
 * channel shows the conversation, and Back returns to the list. The Members button shows or hides the right
 * content at every width (`rightOpen`); left alone, it is showing at wide and closed below.
 */
function Screen({
  mode,
  right = true,
  startOpen,
  startPane = 'centre',
  ...props
}: {
  mode: ModeName;
  right?: boolean;
  /** `undefined`: leave `rightOpen` out, so the width decides until the user presses Members. */
  startOpen?: boolean;
  startPane?: 'left' | 'centre';
} & Partial<ThreeIslandsProps>): JSX.Element {
  const range = useWidthRange();
  const [open, setOpen] = useState<boolean | undefined>(startOpen);
  const [pane, setPane] = useState<'left' | 'centre'>(startPane);
  const showing = open ?? range === 'wide';
  return (
    <KitFrameStage mode={mode}>
      <AppFrame>
        <ThreeIslands
          dock={<SampleDock />}
          left={<SampleChannels onPick={() => setPane('centre')} />}
          leftLabel="Channels"
          centre={
            <SampleConversation
              onMembers={() => setOpen(!showing)}
              onBack={range === 'phone' ? () => setPane('left') : undefined}
            />
          }
          centreLabel="general in Couch Co-op"
          right={right ? <SampleMembers /> : undefined}
          rightLabel="Members"
          rightOpen={open}
          onRightClose={() => setOpen(false)}
          phonePane={pane}
          {...props}
        />
      </AppFrame>
    </KitFrameStage>
  );
}

export const Chat = () => <Screen mode="dark" />;

/** No right slot: the centre island takes its width, and no empty gap or landmark is left. */
export const NoRight = () => <Screen mode="dark" right={false} />;

/** The members showing at every width: the island at wide, a Sheet at compact and phone. */
export const RightOpen = () => <Screen mode="dark" startOpen />;

/** `rightOpen={false}` at wide: two columns, no gap and no empty landmark. Press Members to show the island. */
export const RightClosedWide = () => <Screen mode="dark" startOpen={false} />;

/** A phone that starts on the place list; pick a channel for the conversation. At compact and wide it is the same as Chat. */
export const PhoneLeft = () => <Screen mode="dark" startPane="left" />;

export const ChatLight = () => <Screen mode="light" />;

/** Without a dock, nothing sits above the left island and no bar is left under a phone. */
export const NoDock = () => <Screen mode="dark" dock={undefined} />;

/** In a call: the strip is under the left island at compact and wide, and between the pane and the dock bar on a phone. */
export const InCall = () => <Screen mode="dark" callBar={<SampleCallBar />} />;
