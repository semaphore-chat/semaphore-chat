/**
 * Chat content edge cases — message bodies. Each story opens a dedicated
 * channel whose newest messages are the edge case, so it sits right above
 * the composer at every viewport.
 */
import React from 'react';
import { defineScreen, type LadleStoryComponent } from '../../fixtures/screenStory';
import {
  edgeChatScenario,
  chatHandlers,
  channelPath,
  wallOfTextChannel,
  emojiLinksChannel,
  codeChannel,
  markdownChannel,
  mentionsChannel,
  reactionsChannel,
  editedChannel,
  runsChannel,
  sendStatesChannel,
  slowModeChannel,
  useInjectOptimisticMessages,
} from '../../fixtures/edge/chat';
import type { Channel } from '../../../types/channel.type';

function channelStory(channel: Channel, overlay?: React.ReactNode): LadleStoryComponent {
  return defineScreen(edgeChatScenario, channelPath(channel), { extraHandlers: chatHandlers(), overlay });
}

/** Two ~1.7k/3.4k-char paragraphs (no max length on the backend). */
export const WallOfText = channelStory(wallOfTextChannel);

/** Emoji-only (single, triple, a 64-emoji run with no spaces, ZWJ sequences/flags), link-only, a ~380-char unbroken URL, a 128-char hash and a 100-char "word". */
export const EmojiAndLinks = channelStory(emojiLinksChannel);

/** A fenced block with a ~300-char single line, a 30-line log block, and a long inline `code` run. */
export const CodeBlocks = channelStory(codeChannel);

/** Markdown the composer's parser does/doesn't handle: stacked flags, unclosed markers, #/>/-/1./[]() literals, snake_case, fenced markers, runs of blank lines. */
export const Markdown = channelStory(markdownChannel);

/** 20 user mentions in one message, @here, @channel, and a message mentioning me (highlighted row). */
export const Mentions = channelStory(mentionsChannel);

/** 30 distinct reactions on one message; a 150-reactor count on another. */
export const Reactions = channelStory(reactionsChannel);

/** Edited (short + long), quote-reply of a wall of text, a reply whose target was deleted (hard delete → replyTo: null), a quote of a mention-only message. */
export const EditedAndReplies = channelStory(editedChannel);

/** Six consecutive messages from one author, then six alternating between two authors. */
export const AuthorRuns = channelStory(runsChannel);

const SendStatesDriver: React.FC = () => {
  useInjectOptimisticMessages({ channelId: sendStatesChannel.id }, [
    { text: 'this one never made it to the server', status: 'failed' },
    { text: 'and this one is still sending…', status: 'pending' },
  ]);
  return null;
};

/** Optimistic rows: one failed-to-send (retry/delete), one still pending (clock icon). */
export const SendStates = channelStory(sendStatesChannel, <SendStatesDriver />);

/** Channel with slowmodeSeconds=60 — the backend enforces it, the UI shows nothing. */
export const SlowMode = channelStory(slowModeChannel);
