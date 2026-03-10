import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import PinnedMessagesPanel from '../../components/Moderation/PinnedMessagesPanel';
import type { PinnedMessageDto } from '../../api-client/types.gen';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

// Mock AttachmentPreview so we can assert it renders without side effects
vi.mock('../../components/Message/AttachmentPreview', () => ({
  AttachmentPreview: ({ metadata }: { metadata: { id: string; filename: string } }) => (
    <div data-testid="attachment-preview">{metadata.filename}</div>
  ),
}));

// Mock UserAvatar to avoid FileCacheProvider dependency
vi.mock('../../components/Common/UserAvatar', () => ({
  __esModule: true,
  default: ({ userId }: { userId: string }) => (
    <div data-testid={`avatar-${userId}`} />
  ),
}));

// Mock useCanPerformAction
vi.mock('../../features/roles/useUserPermissions', () => ({
  useCanPerformAction: vi.fn(() => true),
}));

function makePinnedMessage(overrides: Partial<PinnedMessageDto> = {}): PinnedMessageDto {
  return {
    id: 'msg-1',
    channelId: 'channel-1',
    directMessageGroupId: null,
    authorId: 'user-1',
    spans: [],
    reactions: [],
    sentAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    pinned: true,
    pinnedAt: new Date().toISOString(),
    pinnedBy: 'user-2',
    replyCount: 0,
    lastReplyAt: null,
    searchText: null,
    pendingAttachments: null,
    deletedBy: null,
    deletedByReason: null,
    parentMessageId: null,
    author: {
      id: 'user-1',
      username: 'testuser',
      displayName: 'Test User',
      avatarUrl: null,
    },
    attachments: [],
    ...overrides,
  };
}

function setupPinnedEndpoint(messages: PinnedMessageDto[]) {
  server.use(
    http.get('http://localhost:3000/api/moderation/pins/:channelId', () => {
      return HttpResponse.json(messages);
    }),
  );
}

describe('PinnedMessagesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders text-only pinned message', async () => {
    const msg = makePinnedMessage({
      spans: [{ type: 'TEXT' as never, text: 'Hello world' }],
    });
    setupPinnedEndpoint([msg]);

    renderWithProviders(
      <PinnedMessagesPanel channelId="channel-1" communityId="community-1" />,
    );

    expect(await screen.findByText('Hello world')).toBeInTheDocument();
    expect(screen.queryByTestId('attachment-preview')).not.toBeInTheDocument();
  });

  it('renders attachment preview for pinned message with image', async () => {
    const msg = makePinnedMessage({
      attachments: [
        { id: 'file-1', filename: 'photo.png', mimeType: 'image/png', fileType: 'IMAGE', size: 1024 },
      ],
    });
    setupPinnedEndpoint([msg]);

    renderWithProviders(
      <PinnedMessagesPanel channelId="channel-1" communityId="community-1" />,
    );

    expect(await screen.findByTestId('attachment-preview')).toBeInTheDocument();
    expect(screen.getByText('photo.png')).toBeInTheDocument();
  });

  it('renders both text and attachment for message with caption', async () => {
    const msg = makePinnedMessage({
      spans: [{ type: 'TEXT' as never, text: 'Check this out' }],
      attachments: [
        { id: 'file-1', filename: 'screenshot.png', mimeType: 'image/png', fileType: 'IMAGE', size: 2048 },
      ],
    });
    setupPinnedEndpoint([msg]);

    renderWithProviders(
      <PinnedMessagesPanel channelId="channel-1" communityId="community-1" />,
    );

    expect(await screen.findByText('Check this out')).toBeInTheDocument();
    expect(screen.getByTestId('attachment-preview')).toBeInTheDocument();
    expect(screen.getByText('screenshot.png')).toBeInTheDocument();
  });

  it('shows "+N more" when multiple attachments exist', async () => {
    const msg = makePinnedMessage({
      attachments: [
        { id: 'file-1', filename: 'img1.png', mimeType: 'image/png', fileType: 'IMAGE', size: 1024 },
        { id: 'file-2', filename: 'img2.png', mimeType: 'image/png', fileType: 'IMAGE', size: 1024 },
        { id: 'file-3', filename: 'img3.png', mimeType: 'image/png', fileType: 'IMAGE', size: 1024 },
      ],
    });
    setupPinnedEndpoint([msg]);

    renderWithProviders(
      <PinnedMessagesPanel channelId="channel-1" communityId="community-1" />,
    );

    expect(await screen.findByTestId('attachment-preview')).toBeInTheDocument();
    // Only first attachment shown
    expect(screen.getByText('img1.png')).toBeInTheDocument();
    expect(screen.queryByText('img2.png')).not.toBeInTheDocument();
    // "+2 more" badge
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('shows empty state when no pinned messages', async () => {
    setupPinnedEndpoint([]);

    renderWithProviders(
      <PinnedMessagesPanel channelId="channel-1" communityId="community-1" />,
    );

    expect(await screen.findByText('No pinned messages yet.')).toBeInTheDocument();
  });
});
