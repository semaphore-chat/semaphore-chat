/**
 * Chat content edge cases — the pinned messages panel with media: a pinned
 * video shows its server thumbnail, like it does in the channel.
 */
import { Box } from '@mui/material';
import { http, HttpResponse } from 'msw';
import { defineComponent } from '../../fixtures/componentStory';
import { edgeChatScenario, edgeCommunityId, chatHandlers, filesChannel, edgeUsers } from '../../fixtures/edge/chat';
import PinnedMessagesPanel from '../../../components/Moderation/PinnedMessagesPanel';
import type { PinnedMessageDto } from '../../../api-client/types.gen';

const video = edgeChatScenario.messagesByChannel[filesChannel.id].find((m) =>
  m.attachments.some((a) => a.fileType === 'VIDEO'),
)!;
const author = edgeUsers.find((u) => u.id === video.authorId) ?? null;

const pinnedVideo = {
  ...video,
  pinned: true,
  pinnedAt: video.sentAt,
  pinnedBy: video.authorId,
  author: author && {
    id: author.id,
    username: author.username,
    displayName: author.displayName,
    avatarUrl: author.avatarUrl,
  },
} as unknown as PinnedMessageDto;

/** A pinned video with a server thumbnail: the preview shows it. */
export const PinnedVideoWithThumbnail = defineComponent(
  edgeChatScenario,
  () => (
    <Box sx={{ height: '100dvh' }}>
      <PinnedMessagesPanel channelId={filesChannel.id} communityId={edgeCommunityId} />
    </Box>
  ),
  {
    maxWidth: false,
    extraHandlers: [
      http.get('/api/moderation/pins/:channelId', () => HttpResponse.json([pinnedVideo])),
      ...chatHandlers(),
    ],
  },
);
