import { http, HttpResponse } from 'msw';
import HomeInviteCard from '../../components/Home/HomeInviteCard';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

const communities = bigCommunityScenario.communities.map((c) => ({
  id: c.id,
  name: c.name,
  description: null,
  avatar: null,
  banner: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}));

/** Home's "Invite people" card. Quick invite targets only communities you can invite to. */
const story = (extraHandlers: Parameters<typeof defineComponent>[2] = {}) =>
  defineComponent(
    bigCommunityScenario,
    () => <HomeInviteCard communities={communities} onDismiss={() => {}} />,
    extraHandlers,
  );

export const Default = story();

/** A plain Member everywhere (an Invite Manager's usual case): an invite to the instance alone. */
export const NoCommunityRights = story({
  extraHandlers: [
    http.get('/api/roles/my/community/:communityId', ({ params }) =>
      HttpResponse.json({
        resourceType: 'COMMUNITY',
        userId: bigCommunityScenario.me.id,
        resourceId: String(params.communityId),
        roles: [{ id: 'member', name: 'Member', actions: ['READ_MESSAGE'] }],
      }),
    ),
  ],
});

/** Quick invite waits for the roles, so it can't send the wrong communities. */
export const CheckingCommunityRoles = story({
  extraHandlers: [http.get('/api/roles/my/community/:communityId', () => new Promise<never>(() => {}))],
});

export const NoCommunities = defineComponent(bigCommunityScenario, () => (
  <HomeInviteCard communities={[]} onDismiss={() => {}} />
));
