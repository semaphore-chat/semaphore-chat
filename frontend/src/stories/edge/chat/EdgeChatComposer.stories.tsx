/**
 * Chat content edge cases — composer states, all driven through the real UI
 * (right-click / long-press → Reply, the hidden file input, typing).
 */
import React from 'react';
import { defineScreen, type LadleStoryComponent } from '../../fixtures/screenStory';
import {
  edgeChatScenario,
  edgeChatManyMembersScenario,
  chatHandlers,
  channelPath,
  wallOfTextChannel,
  mentionsChannel,
  runsChannel,
  useDriver,
  composerTextarea,
  attachFiles,
  typeInto,
  clickButtonByLabel,
  findMessageRow,
  openMessageActions,
  clickActionItem,
  wait,
  FIVE_FILES,
  FOUR_LINE_DRAFT,
  type DriverStep,
} from '../../fixtures/edge/chat';
import type { Channel } from '../../../types/channel.type';

const Drive: React.FC<{ steps: DriverStep[] }> = ({ steps }) => {
  useDriver(steps);
  return null;
};

function story(channel: Channel, steps: DriverStep[], scenario = edgeChatScenario): LadleStoryComponent {
  return defineScreen(scenario, channelPath(channel), { extraHandlers: chatHandlers(scenario), overlay: <Drive steps={steps} /> });
}

/** Steps: quote-reply the wall-of-text message, attach 5 files, type a 4-line draft. */
const replyFilesDraft: DriverStep[] = [
  () => {
    const row = findMessageRow('So here is the full write-up', { last: true });
    if (!row) return false;
    openMessageActions(row);
  },
  wait(700),
  () => clickActionItem(/^Reply$/),
  () => !!composerTextarea(),
  () => attachFiles(FIVE_FILES),
  wait(200),
  () => typeInto(composerTextarea()!, FOUR_LINE_DRAFT),
];

/** Reply banner (quoting a wall of text) + 5 file previews + a 4-line draft, all at once. */
export const ReplyFilesDraft = story(wallOfTextChannel, replyFilesDraft);

/** Same composer state on a short phone viewport (on-screen keyboard approximation; phone-short only). */
export const ComposerKeyboard = story(wallOfTextChannel, replyFilesDraft);

/**
 * "@a" typed with 61 community members, 50+ of whom match (the dropdown caps
 * at 10: specials + 8 users). NOTE: at this member count channel screens
 * throw a React "Maximum update depth exceeded" page error (see report).
 */
export const MentionDropdownManyMatches = story(
  mentionsChannel,
  [() => !!composerTextarea(), wait(400), () => typeInto(composerTextarea()!, 'hey @a')],
  edgeChatManyMembersScenario,
);

/** Composer emoji picker open (bottom sheet on touch, popover on desktop). */
export const EmojiPickerOpen = story(runsChannel, [() => !!composerTextarea(), wait(300), () => clickButtonByLabel('add emoji')]);

/** Long-press on a message (touch) → actions sheet; right-click on desktop → context menu. */
export const MessageActionsOpen = story(runsChannel, [
  () => {
    const row = findMessageRow('one line at a time');
    if (!row) return false;
    openMessageActions(row);
  },
]);
