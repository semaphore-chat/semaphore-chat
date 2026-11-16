/**
 * A hidden test fixture at `/__lounge/community/:communityId`: every piece of the shell on real data
 * before any real screen is registered. The dock, the community's left island with the user card, the
 * members island, the call slot (call bar, call surface, voice notice) and the banners, around a
 * placeholder centre. Nothing links to it; it is reached only with the new design on (the tab's
 * `?design=lounge` preview or the account switch at /debug/design). With the design off it is the old
 * shell's not-found page.
 *
 * It is the community home's descriptor (`communityHomeParts`) with two differences: a placeholder centre,
 * and `links`, so the dock and the "All communities" sheet move between communities on the fixture and
 * the frame stays mounted.
 */
import type { JSX } from 'react';
import { Button, Stack, Text } from '../../../kit';
import type { LoungeLinks } from '../links';
import { useScreenChrome, type LoungeScreenProps, type ThreeIslandsScreen } from '../screen';
import { useCommunityTitle } from './communityHomeParts';
import { loungeCommunityFixturePath } from '../../loungeRoutes';

const FIXTURE_LINKS: LoungeLinks = Object.freeze({
  community: (id: string) => `#${loungeCommunityFixturePath(id)}`,
});

/**
 * The placeholder centre: the community's name as the screen's heading, one line, and a way to open the
 * members where they are not shown beside it (below wide they are a Sheet). A phone shows the left pane.
 */
function FixtureCentre({ params }: LoungeScreenProps): JSX.Element {
  const title = useCommunityTitle(params);
  const { rightOpen, setRightOpen } = useScreenChrome();
  return (
    <Stack gap="md" align="start">
      <Text variant="title" as="h1" truncate>
        {title ?? 'Community'}
      </Text>
      <span data-testid="lounge-fixture-centre">
        <Text tone="secondary">Pick a channel or a room on the left.</Text>
      </span>
      {!rightOpen && (
        <Button variant="ghost" onClick={() => setRightOpen(true)}>
          Members
        </Button>
      )}
    </Stack>
  );
}

const communityFixtureScreen: ThreeIslandsScreen = {
  template: 'threeIslands',
  place: 'community',
  phonePane: 'left',
  Centre: FixtureCentre,
  right: 'members',
  useTitle: useCommunityTitle,
  links: FIXTURE_LINKS,
};

export default communityFixtureScreen;
