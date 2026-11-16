/**
 * A hidden test fixture at `/__lounge/call`: the smallest `threeIslands` screen, so the frame's pieces (and
 * so the call slot: the call bar, the call surface, the voice notice) can be reached in the app before any
 * real screen is registered. Nothing links to it. PR 8 replaces it with the fixture community route.
 */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Text } from '../../../kit';
import type { LoungeScreenProps, ThreeIslandsScreen } from '../screen';

const TITLE = 'Call fixture';

function CallFixtureCentre(_props: LoungeScreenProps): JSX.Element {
  const navigate = useNavigate();
  return (
    <div>
      <Text variant="title" as="h1">
        {TITLE}
      </Text>
      <Button variant="ghost" onClick={() => navigate('/')}>
        Back to the app
      </Button>
    </div>
  );
}

const callFixtureScreen: ThreeIslandsScreen = {
  template: 'threeIslands',
  place: 'inbox',
  phonePane: 'centre',
  Centre: CallFixtureCentre,
  right: null,
  useTitle: () => TITLE,
};

export default callFixtureScreen;
