/**
 * Chat content — combined worst cases: everything hard in the newest few
 * messages of one channel, plus the heaviest composer / thread states on top.
 */
import React from 'react';
import { defineScreen } from '../../fixtures/screenStory';
import {
  edgeChatManyMembersScenario,
  chatHandlers,
  channelPath,
  worstChannel,
  useDriver,
  useInjectOptimisticMessages,
  composerTextarea,
  attachFiles,
  typeInto,
  findMessageRow,
  openMessageActions,
  clickActionItem,
  clickButtonByText,
  wait,
  FIVE_FILES,
  FOUR_LINE_DRAFT,
  type DriverStep,
} from '../../fixtures/edge/chat';

const WorstComposer: React.FC = () => {
  useInjectOptimisticMessages({ channelId: worstChannel.id }, [{ text: 'sending this before I lose it', status: 'failed' }]);
  const steps: DriverStep[] = [
    () => {
      const row = findMessageRow('const result = await deliveryQueueConsumer', { last: true });
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
  useDriver(steps);
  return null;
};

/**
 * @here + 8 mentions + long URL + 18 reactions + edited + 200-reply thread,
 * a wide code block quoting a wall of text with a 150-reactor count, tall +
 * wide images + huge zip, a 40-emoji run, a failed send — and the composer
 * loaded with a reply banner, 5 files and a 4-line draft. 61 community
 * members (see MentionDropdownManyMatches for the page error that brings).
 */
export const EverythingAtOnce = defineScreen(edgeChatManyMembersScenario, channelPath(worstChannel), {
  extraHandlers: chatHandlers(edgeChatManyMembersScenario),
  overlay: <WorstComposer />,
});

const OpenThread: React.FC = () => {
  useDriver([() => clickButtonByText(/^200 replies/)]);
  return null;
};

/** The same channel with the 200-reply thread panel open over it. */
export const EverythingWithThreadOpen = defineScreen(edgeChatManyMembersScenario, channelPath(worstChannel), {
  extraHandlers: chatHandlers(edgeChatManyMembersScenario),
  overlay: <OpenThread />,
});
