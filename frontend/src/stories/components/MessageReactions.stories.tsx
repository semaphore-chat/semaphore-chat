import { MessageReactions } from '../../components/Message/MessageReactions';
import { defineComponent } from '../fixtures/componentStory';
import { createReaction } from '../../__tests__/test-utils/factories';
import { bigCommunityScenario } from '../fixtures/scenarios';

export const Default = defineComponent(bigCommunityScenario, () => (
  <MessageReactions
    messageId="story-message-1"
    reactions={[
      createReaction({ emoji: '👍', userIds: [bigCommunityScenario.me.id, bigCommunityScenario.users[0].id] }),
      createReaction({ emoji: '🎉', userIds: [bigCommunityScenario.users[1].id] }),
      createReaction({ emoji: '😂', userIds: [bigCommunityScenario.users[2].id, bigCommunityScenario.users[3].id, bigCommunityScenario.users[4].id] }),
    ]}
    onReactionClick={() => {}}
  />
));
