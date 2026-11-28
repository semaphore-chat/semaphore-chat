/**
 * A hidden stage fixture (`/__lounge/community/:communityId/room/:channelId`): the `stage` template around a
 * placeholder room, until the voice room (V1) is registered. With the design off it is the old shell's not-found page.
 *
 * At compact and wide the room is the centre of the community's frame (the dock, the channels and rooms, the call
 * bar); on a phone it is the full stage. While the room is the call you are in (`useShowsCall`), the room's controls
 * are the call's at every width: they register with the frame (`useStageCallControls`), which then leaves its call bar
 * out. Here the shell's call bar stands in for them (V1 brings mute, deafen, the camera, sharing and Leave). In any
 * other room the frame keeps its call bar.
 */
import type { JSX } from 'react';
import { Pill, StageLayout, Text } from '../../../kit';
import { useVoice } from '../../../contexts/VoiceContext';
import type { LoungeParams, LoungeScreenProps, StageScreen } from '../screen';
import { useStageCallControls } from '../screen';
import { ShellCall } from '../pieces/call/ShellCall';
import { useRouteChannel } from './chat/channelTitle';
import { FIXTURE_LINKS } from './fixtureLinks';

/** Whether the room on screen is the call you are in. */
function useShowsCall(params: LoungeParams): boolean {
  const { isConnected, currentChannelId } = useVoice();
  return isConnected && currentChannelId !== null && currentChannelId === params.channelId;
}

function useRoomTitle(params: LoungeParams): string | null {
  const { channel } = useRouteChannel(params);
  return channel === null ? null : channel.name;
}

/** The room's call controls: mounted, they tell the frame to leave its call bar out. */
function FixtureCallControls(): JSX.Element {
  useStageCallControls();
  return (
    <div style={{ width: '100%' }}>
      <ShellCall />
    </div>
  );
}

function FixtureStage({ params }: LoungeScreenProps): JSX.Element {
  const title = useRoomTitle(params) ?? 'Room';
  const here = useShowsCall(params);
  return (
    <StageLayout
      inIsland
      stageLabel={title}
      header={
        <>
          <Text variant="title" as="h1" truncate>
            {title}
          </Text>
          {here && <Pill tone="accent">{"You're here"}</Pill>}
        </>
      }
      stage={
        <div data-testid="lounge-stage-fixture-stage">
          <Text tone="secondary">The room's people and shares go here.</Text>
        </div>
      }
      controls={here ? <FixtureCallControls /> : <Text tone="secondary">{"You're not in this room."}</Text>}
    />
  );
}

const stageFixtureScreen: StageScreen = {
  template: 'stage',
  place: 'community',
  Stage: FixtureStage,
  useShowsCall,
  useTitle: useRoomTitle,
  links: FIXTURE_LINKS,
};

export default stageFixtureScreen;
