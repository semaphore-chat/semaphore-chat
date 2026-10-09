import React from 'react';
import { defineScreen } from '../fixtures/screenStory';
import { asElectron } from '../fixtures/electron';
import { bigCommunityScenario, primaryCommunity, generalChannel } from '../fixtures/scenarios';
import { useSimulateReactions } from '../fixtures/reactions';
import type { Reaction } from '../../types/message.type';

const generalPath = `/community/${primaryCommunity.id}/channel/${generalChannel.id}`;

/** #general: ~40 messages, consecutive runs, a reply, reactions, an image attachment, a mention, a pinned message, an edited message. */
export const ChannelChatBusy = defineScreen(bigCommunityScenario, generalPath);

const generalMessages = bigCommunityScenario.messagesByChannel[generalChannel.id];
const newestGeneralMessage = generalMessages[generalMessages.length - 1];
const reactors = bigCommunityScenario.users.map((u) => u.id);
const newReactions: Reaction[] = ['👍', '🎉', '❤️', '😂', '🔥', '👀', '🙏', '💯', '🚀', '🙌', '✅', '🥳'].map(
  (emoji, i) => ({
    emoji,
    userIds: i % 4 === 0 ? [bigCommunityScenario.me.id, reactors[i % reactors.length]] : [reactors[i % reactors.length]],
  }),
);

const ReactToNewest: React.FC = () => {
  useSimulateReactions({ channelId: generalChannel.id }, newestGeneralMessage.id, newReactions);
  return null;
};

/** The busy #general, pinned to the bottom, when 12 reactions arrive on the
 * newest message: the list stays pinned, so the new reaction row is fully
 * visible above the composer instead of growing below the fold. */
export const ChannelChatBusyReactionAdded = defineScreen(bigCommunityScenario, generalPath, {
  overlay: <ReactToNewest />,
});

/** The busy #general in a narrow (1280) and a wide (1920) desktop window: the
 * desktop type scale and the 80ch message cap at both ends of the range. */
export const ChannelChatBusyWide = defineScreen(bigCommunityScenario, generalPath);
ChannelChatBusyWide.meta = { viewports: ['desktop-1280', 'desktop-1920'] };

/** The same in the Electron app at 1920. */
export const ChannelChatBusyWideElectron = asElectron(defineScreen(bigCommunityScenario, generalPath));
ChannelChatBusyWideElectron.meta = { viewports: ['desktop-1920'] };
