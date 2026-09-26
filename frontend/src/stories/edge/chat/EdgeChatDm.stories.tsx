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
  mediaSettled,
  scrollListToBottom,
  FIVE_FILES,
  INJECTED_ROW,
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

const DmUploadProgressDriver: React.FC = () => {
  useInjectOptimisticMessages({ dmId: EDGE_DM_ID }, [
    {
      text: 'the photos from saturday',
      status: 'pending',
      uploads: [
        { name: 'IMG_5120.png', type: 'image/png', size: [1200, 900], color: '#EB459E', status: 'waiting', bytes: 2_600_000 },
        { name: 'IMG_5121.png', type: 'image/png', size: [900, 1200], color: '#3BA55D', status: 'waiting', bytes: 2_400_000 },
      ],
    },
    {
      text: '',
      status: 'sent',
      uploads: [
        { name: 'IMG_5122.png', type: 'image/png', size: [1200, 900], color: '#5865F2', status: 'uploading', progress: 0.64, bytes: 3_100_000 },
        { name: 'tickets.pdf', type: 'application/pdf', status: 'failed', error: 'Network error while uploading', bytes: 240_000 },
      ],
    },
  ]);
  useDriver([() => !!document.querySelector(INJECTED_ROW), mediaSettled(), scrollListToBottom()]);
  return null;
};

/** 1:1 DM: a message still sending (its photos waiting) and a sent one uploading, one file failed. */
export const DmUploadProgress = dmStory(EDGE_DM_ID, <DmUploadProgressDriver />);

/** 1:1 DM composer: reply banner + 5 files + 4-line draft. */
export const DmComposerLoaded = dmStory(
  EDGE_DM_ID,
  <Drive
    steps={[
      // Open the menu only once the messages are in, their images have sized and the
      // list has stopped moving (else it anchors to a row still moving, and the list
      // ends up pinned to the bottom or not depending on load timing).
      () => !!findMessageRow('thank you!!'),
      mediaSettled(),
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
      // The composer grew three times over the list: show its newest messages.
      scrollListToBottom(),
      mediaSettled(),
    ]}
  />,
);

/** 10-person group DM, mention dropdown open ("@a", filtered locally from the group's members). */
export const GroupDmMentionDropdown = dmStory(
  EDGE_GROUP_DM_ID,
  <Drive steps={[() => !!composerTextarea(), wait(400), () => typeInto(composerTextarea()!, '@a')]} />,
);
