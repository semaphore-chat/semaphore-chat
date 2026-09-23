import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import QuotePreview from '../../components/Message/QuotePreview';

const mockNavigate = vi.fn();
let mockParams: Record<string, string> = {};
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams,
  };
});

vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  userControllerGetUserByIdOptions: () => ({
    queryKey: ['user', 'author-1'],
    queryFn: async () => ({ id: 'author-1', username: 'alice', displayName: 'Alice' }),
  }),
}));

const replyTo = {
  id: 'msg-42',
  authorId: 'author-1',
  spans: [{ type: 'PLAINTEXT', text: 'original text' }],
  deletedAt: null,
} as never;

describe('QuotePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams = {};
  });

  it('navigates to the /direct-messages route for DM quotes', async () => {
    const { user } = renderWithProviders(
      <QuotePreview replyTo={replyTo} directMessageGroupId="dm-7" />,
    );
    await user.click(screen.getByText('original text'));
    expect(mockNavigate).toHaveBeenCalledWith('/direct-messages/dm-7?highlight=msg-42');
  });

  it('navigates to the channel route for channel quotes', async () => {
    mockParams = { communityId: 'c1' };
    const { user } = renderWithProviders(
      <QuotePreview replyTo={replyTo} channelId="ch-1" />,
    );
    await user.click(screen.getByText('original text'));
    expect(mockNavigate).toHaveBeenCalledWith('/community/c1/channel/ch-1?highlight=msg-42');
  });
});
