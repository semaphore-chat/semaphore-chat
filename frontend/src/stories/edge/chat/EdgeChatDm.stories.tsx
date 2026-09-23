/**
 * Chat content edge cases — DM variants where the DM screen differs
 * (seen-by receipts, local mention filtering, group DMs).
 */
import React from 'react';
import { defineScreen, type LadleStoryComponent } from '../../fixtures/screenStory';
import {
  edgeChatScenario,
  chatHandlers,
  dmPath,
  EDGE_DM_ID,
  EDGE_GROUP_DM_ID,
  useDriver,
  useInjectOptimisticMessages,
  composerTextarea,
  attachFiles,
  typeInto,
  findMessageRow,
  openMessageActions,
  clickActionItem,
  wait,
  FIVE_FILES,
  FOUR_LINE_DRAFT,
  type DriverStep,
} from '../../fixtures/edge/chat';

const Drive: React.FC<{ steps: DriverStep[] }> = ({ steps }) => {
  useDriver(steps);
  return null;
};

function dmStory(id: string, overlay?: React.ReactNode): LadleStoryComponent {
  return defineScreen(edgeChatScenario, dmPath(id), { extraHandlers: chatHandlers(), overlay });
}

/** 1:1 DM: edited wall of text, emoji-only, long URL, quote-reply with a huge zip + tall image, 12 reactions, lone GIF. */
export const DmEdgeContent = dmStory(EDGE_DM_ID);

const DmSendStatesDriver: React.FC = () => {
  useInjectOptimisticMessages({ dmId: EDGE_DM_ID }, [
    { text: 'this one failed to send', status: 'failed' },
    { text: 'still sending…', status: 'pending' },
  ]);
  return null;
};

/** 1:1 DM with a failed and a pending optimistic message under my read-receipt ticks. */
export const DmSendStates = dmStory(EDGE_DM_ID, <DmSendStatesDriver />);

/** 1:1 DM composer: reply banner + 5 files + 4-line draft. */
export const DmComposerLoaded = dmStory(
  EDGE_DM_ID,
  <Drive
    steps={[
      () => {
        const row = findMessageRow('thank you!!', { last: true });
        if (!row) return false;
        openMessageActions(row);
      },
      wait(700),
      () => clickActionItem(/^Reply$/),
      () => !!composerTextarea(),
      () => attachFiles(FIVE_FILES),
      wait(200),
      () => typeInto(composerTextarea()!, FOUR_LINE_DRAFT),
    ]}
  />,
);

/** 10-person group DM, mention dropdown open ("@a", filtered locally from the group's members). */
export const GroupDmMentionDropdown = dmStory(
  EDGE_GROUP_DM_ID,
  <Drive steps={[() => !!composerTextarea(), wait(400), () => typeInto(composerTextarea()!, '@a')]} />,
);
