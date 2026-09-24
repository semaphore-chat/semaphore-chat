import React from 'react';
import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario, primaryCommunity, generalChannel } from '../fixtures/scenarios';
import { edgeChatScenario, chatHandlers, dmPath, EDGE_DM_ID, edgeUsers } from '../fixtures/edge/chat';
import { useSimulateTyping } from '../fixtures/typing';

const channelTypist = bigCommunityScenario.users[0].id;
// The other member of the edge 1:1 DM (edgeUsers[0], "ava" in edge/chat.ts).
const dmTypist = edgeUsers[0].id;

const ChannelTyping: React.FC = () => {
  useSimulateTyping({ channelId: generalChannel.id }, [channelTypist]);
  return null;
};

const DmTyping: React.FC = () => {
  useSimulateTyping({ directMessageGroupId: EDGE_DM_ID }, [dmTypist]);
  return null;
};

/** The busy #general (see ChannelChatBusy) while someone is typing: the
 * newest message must stay fully visible above the "is typing..." line. */
export const ChannelTypingBusy = defineScreen(
  bigCommunityScenario,
  `/community/${primaryCommunity.id}/channel/${generalChannel.id}`,
  { overlay: <ChannelTyping /> },
);

/** A 1:1 DM with a long history (see edge-chat-dm--dm-edge-content) while
 * the other person is typing. */
export const DmTypingLong = defineScreen(edgeChatScenario, dmPath(EDGE_DM_ID), {
  extraHandlers: chatHandlers(),
  overlay: <DmTyping />,
});
