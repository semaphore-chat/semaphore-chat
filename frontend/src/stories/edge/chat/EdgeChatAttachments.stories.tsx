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
  useInjectOptimisticMessages,
  sizedImageId,
  mediaSettled,
  scrollListToBottom,
  INJECTED_ROW,
  type DriverStep,
  type OptimisticSpec,
} from '../../fixtures/edge/chat';
import { edgeScreen } from '../../fixtures/edge/states';
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
 * The message shows up at once as pending, its files waiting for the
 * server's ack (which never comes in the sandbox) before they upload.
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

const Inject: React.FC<{ channel: Channel; specs: OptimisticSpec[] }> = ({ channel, specs }) => {
  useInjectOptimisticMessages({ channelId: channel.id }, specs);
  // The rows go in after the list positioned itself: once they're there and
  // the media has sized, show the newest messages.
  useDriver([() => !!document.querySelector(INJECTED_ROW), mediaSettled(), scrollListToBottom()]);
  return null;
};

function uploadStory(specs: OptimisticSpec[]): LadleStoryComponent {
  return channelStory(filesChannel, <Inject channel={filesChannel} specs={specs} />);
}

const MIXED_UPLOADS: OptimisticSpec[] = [
  {
    text: 'here are the recordings from last night',
    status: 'sent',
    uploads: [
      { name: 'IMG_4031.png', type: 'image/png', size: [1200, 900], color: '#3BA55D', status: 'uploading', progress: 0.72, bytes: 3_400_000 },
      { name: 'incident-call-2026-09-22.mp4', type: 'video/mp4', status: 'uploading', progress: 0.35, bytes: 48_200_000 },
      { name: 'timeline.pdf', type: 'application/pdf', status: 'attaching', bytes: 820_000 },
    ],
  },
];

/** Sent, files uploading: an image at 72 %, a video at 35 % (with Cancel), a PDF the server is still storing. */
export const UploadProgress = uploadStory(MIXED_UPLOADS);

/**
 * Failures: a message whose send failed (Retry/Delete on the message, its
 * files not uploaded), and a sent one where one upload failed (Retry/Remove
 * on that file) while the other carries on.
 */
export const UploadFailed = uploadStory([
  {
    text: 'screenshots of the dashboard',
    status: 'failed',
    uploads: [
      { name: 'dashboard-1.png', type: 'image/png', size: [1600, 1000], color: '#5865F2', status: 'waiting', bytes: 1_200_000 },
      { name: 'dashboard-2.png', type: 'image/png', size: [1600, 1000], color: '#EB459E', status: 'waiting', bytes: 1_100_000 },
    ],
  },
  {
    text: '',
    status: 'sent',
    uploads: [
      { name: 'heap-dump.hprof.zip', type: 'application/zip', status: 'failed', error: 'Network error while uploading', bytes: 24_900_000 },
      { name: 'IMG_4032.png', type: 'image/png', size: [900, 1200], color: '#FAA61A', status: 'uploading', progress: 0.58, bytes: 2_900_000 },
    ],
  },
]);

/** Done: every file attached, the message shows the real attachments (no tiles left). */
export const UploadAllDone = uploadStory([
  {
    text: 'here are the recordings from last night',
    status: 'sent',
    attachments: [
      { id: sizedImageId('upload-done', 1200, 900), filename: 'IMG_4031.png', mimeType: 'image/png', fileType: 'IMAGE', size: 3_400_000 },
      { id: 'edge-chat-upload-done-pdf', filename: 'timeline.pdf', mimeType: 'application/pdf', fileType: 'DOCUMENT', size: 820_000 },
    ],
  },
]);

/** Long, unbroken file names truncate on the tile (full name in its title); the error wraps. */
export const UploadLongNames = uploadStory([
  {
    text: '',
    status: 'sent',
    uploads: [
      { name: 'delivery-queue-consumer-heap-dump-production-eu-west-1-2026-09-22T23-41-07Z.hprof.zip', type: 'application/zip', status: 'uploading', progress: 0.12, bytes: 1_900_000_000 },
      { name: 'Q3 Delivery Reliability Review — FINAL (v7, really final) — with appendix and all the charts.pdf', type: 'application/pdf', status: 'failed', error: 'File type not allowed: application/x-msdownload renamed to .pdf', bytes: 12_000_000 },
      { name: 'screenshot-2026-09-22-at-23.41.07-from-the-staging-cluster-dashboard.png', type: 'image/png', size: [1200, 800], color: '#5865F2', status: 'uploading', progress: 0.99, bytes: 640_000 },
    ],
  },
]);

/** Light theme: uploading and failed tiles. */
export const UploadProgressLight = edgeScreen(edgeChatScenario, channelPath(filesChannel), {
  theme: { mode: 'light', accentColor: 'teal', intensity: 'minimal' },
  extraHandlers: chatHandlers(),
  overlay: (
    <Inject
      channel={filesChannel}
      specs={[
        {
          ...MIXED_UPLOADS[0],
          uploads: [
            ...MIXED_UPLOADS[0].uploads!.slice(0, 2),
            { name: 'timeline.pdf', type: 'application/pdf', status: 'failed', error: 'Network error while uploading', bytes: 820_000 },
          ],
        },
      ]}
    />
  ),
});
