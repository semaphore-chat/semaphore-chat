import { useState, type JSX } from 'react';
import { AppFrame, ThreeIslands, type ThreeIslandsProps } from '../../kit';
import type { ModeName } from '../../theme/derive/derivePalette';
import { KitFrameStage } from '../fixtures/kitStory';
import { SampleChannels, SampleConversation, SampleDock, SampleMembers } from '../fixtures/layoutSamples';

/**
 * The chat screen's layout. Wide: the dock above the channels | the conversation | the members. Compact:
 * the members are a Sheet, opened with the Members button. Phone: one pane with the dock as the bar under it.
 */
function Screen({
  mode,
  right = true,
  startOpen = false,
  ...props
}: { mode: ModeName; right?: boolean; startOpen?: boolean } & Partial<ThreeIslandsProps>): JSX.Element {
  const [open, setOpen] = useState(startOpen);
  return (
    <KitFrameStage mode={mode}>
      <AppFrame>
        <ThreeIslands
          dock={<SampleDock />}
          left={<SampleChannels />}
          leftLabel="Channels"
          centre={<SampleConversation />}
          centreLabel="general in Couch Co-op"
          right={right ? <SampleMembers /> : undefined}
          rightLabel="Members"
          rightOpen={open}
          onRightClose={() => setOpen(false)}
          {...props}
        />
      </AppFrame>
    </KitFrameStage>
  );
}

export const Chat = () => <Screen mode="dark" />;

/** No right slot: the centre island takes its width, and no empty gap or landmark is left. */
export const NoRight = () => <Screen mode="dark" right={false} />;

/** Meant for compact and phone, where the members are a Sheet. At wide the island shows instead. */
export const RightOpen = () => <Screen mode="dark" startOpen />;

/** A phone that shows the place list. At compact and wide it is the same as Chat. */
export const PhoneLeft = () => <Screen mode="dark" phonePane="left" />;

export const ChatLight = () => <Screen mode="light" />;

/** Without a dock, nothing sits above the left island and no bar is left under a phone. */
export const NoDock = () => <Screen mode="dark" dock={undefined} />;
