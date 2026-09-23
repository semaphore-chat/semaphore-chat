/**
 * Chat content edge cases — attachments, GIFs and link previews.
 */
import React from 'react';
import { defineScreen, type LadleStoryComponent } from '../../fixtures/screenStory';
import {
  edgeChatScenario,
  chatHandlers,
  channelPath,
  mediaChannel,
  multiImageChannel,
  filesChannel,
  gifsChannel,
  useDriver,
  composerTextarea,
  attachFiles,
  typeInto,
  clickButtonByLabel,
  wait,
  type DriverStep,
} from '../../fixtures/edge/chat';
import type { Channel } from '../../../types/channel.type';

const Drive: React.FC<{ steps: DriverStep[] }> = ({ steps }) => {
  useDriver(steps);
  return null;
};

function channelStory(channel: Channel, overlay?: React.ReactNode): LadleStoryComponent {
  return defineScreen(edgeChatScenario, channelPath(channel), { extraHandlers: chatHandlers(), overlay });
}

/** A 400×2400 image, a 3200×300 panorama, and a 16×16 image with no caption. */
export const TallWideTiny = channelStory(mediaChannel);

/** Five mixed-aspect images in one message, then image + PDF + video in one message. */
export const MultiImage = channelStory(multiImageChannel);

/** Video (with thumbnail), a 24.9 MB zip with a 90-char filename, audio, and a message whose 3 attachments are still uploading (pendingAttachments=3). */
export const FilesAndPendingUploads = channelStory(filesChannel);

/** A lone GIF URL (inline embed), a .gif attachment, a link preview with og:image + very long title/description, and a title-only preview. */
export const GifsAndLinkPreviews = channelStory(gifsChannel);

/**
 * Uploading from the composer: two files attached + caption, send pressed.
 * Attachment sends skip the optimistic row and wait for the server ack
 * (never arrives in the sandbox), so this is what the user sees mid-send.
 */
export const UploadInProgress = channelStory(
  filesChannel,
  <Drive
    steps={[
      () => !!composerTextarea(),
      () => attachFiles([
        { name: 'IMG_4031.png', type: 'image/png', size: [1200, 900], color: '#3BA55D' },
        { name: 'incident-call-2026-09-22.mp4', type: 'video/mp4' },
      ]),
      () => typeInto(composerTextarea()!, 'here are the recordings from last night'),
      wait(300),
      () => clickButtonByLabel('send'),
    ]}
  />,
);
