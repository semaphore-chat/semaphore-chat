/**
 * The marker at `/__lounge`: a test fixture, not a template screen. It proves
 * the new shell is on screen (with the kit, the user's appearance and the shared
 * call state) and gives the way back. Kept as the E2E target until the new
 * design becomes the default; nothing links to it. A `bare` descriptor: it
 * fills the frame with one island of its own.
 */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Island, Text } from '../../../kit';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useVoice } from '../../../contexts/VoiceContext';
import type { BareScreen, LoungeScreenProps } from '../screen';

const MARKER_TITLE = 'New design preview';

/** "Not in a call", or where the call is: the channel or the direct message. */
function voiceLine(state: {
  isConnected: boolean;
  channelName: string | null;
  dmGroupName: string | null;
}): string {
  if (!state.isConnected) {
    return 'Not in a call';
  }
  const place = state.channelName ?? state.dmGroupName;
  return place ? `In a call in ${place}` : 'In a call';
}

function MarkerBody(_props: LoungeScreenProps): JSX.Element {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  // The shared call state (VoiceProvider, above both shells): read only, no actions.
  const state = useVoice();
  const name = user ? user.displayName || user.username : null;
  return (
    <Island as="main" label={MARKER_TITLE} scroll>
      <Text variant="title" as="h1">
        {MARKER_TITLE}
      </Text>
      <p>
        <Text variant="name" truncate>
          {name ?? 'Loading your profile'}
        </Text>
        <Text tone="secondary" as="span">
          <span data-testid="lounge-voice-line">{voiceLine(state)}</span>
        </Text>
      </p>
      <div>
        <Button onClick={() => navigate('/')}>Back to the app</Button>
      </div>
    </Island>
  );
}

const markerScreen: BareScreen = {
  template: 'bare',
  Body: MarkerBody,
  useTitle: () => MARKER_TITLE,
};

export default markerScreen;
