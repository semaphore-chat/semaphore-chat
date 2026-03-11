import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { SeenByTooltip } from '../../components/Message/SeenByTooltip';

const mockGetReadByCount = vi.fn<(sentAt: string) => number>();
const mockGetReaderIds = vi.fn<(sentAt: string) => string[]>();

vi.mock('../../hooks/useDmPeerReads', () => ({
  useDmPeerReads: () => ({
    getReadByCount: mockGetReadByCount,
    getReaderIds: mockGetReaderIds,
  }),
}));

vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  directMessagesControllerFindDmGroupOptions: () => ({
    queryKey: ['dm-group', 'dm-group-1'],
    queryFn: () => Promise.resolve({
      id: 'dm-group-1',
      isGroup: false,
      members: [
        {
          id: 'member-1',
          userId: 'u2',
          joinedAt: new Date().toISOString(),
          user: { id: 'u2', username: 'alice', displayName: 'Alice', avatarUrl: null },
        },
        {
          id: 'member-2',
          userId: 'u3',
          joinedAt: new Date().toISOString(),
          user: { id: 'u3', username: 'bob', displayName: 'Bob', avatarUrl: null },
        },
      ],
    }),
    staleTime: Infinity,
  }),
}));

const defaultProps = () => ({
  sentAt: '2024-01-15T00:00:00Z',
  directMessageGroupId: 'dm-group-1',
});

describe('SeenByTooltip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReadByCount.mockReturnValue(0);
    mockGetReaderIds.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no peers have read the message', () => {
    mockGetReadByCount.mockReturnValue(0);

    const { container } = renderWithProviders(<SeenByTooltip {...defaultProps()} />);

    expect(container.innerHTML).toBe('');
    expect(screen.queryByTestId('VisibilityIcon')).not.toBeInTheDocument();
  });

  it('shows blue eye icon when at least one peer has read', async () => {
    mockGetReadByCount.mockReturnValue(1);
    mockGetReaderIds.mockReturnValue(['u2']);

    renderWithProviders(<SeenByTooltip {...defaultProps()} />);

    await waitFor(() => {
      expect(screen.getByTestId('VisibilityIcon')).toBeInTheDocument();
    });
  });

  it('shows "Seen by [name]" tooltip for 1:1 DM', async () => {
    mockGetReadByCount.mockReturnValue(1);
    mockGetReaderIds.mockReturnValue(['u2']);

    const { user } = renderWithProviders(<SeenByTooltip {...defaultProps()} />);

    const indicator = screen.getByTestId('VisibilityIcon').closest('span')!;
    await user.hover(indicator);

    await waitFor(() => {
      expect(screen.getByText('Seen by Alice')).toBeInTheDocument();
    });
  });

  it('shows "Seen by N" with per-user list for group DM', async () => {
    mockGetReadByCount.mockReturnValue(2);
    mockGetReaderIds.mockReturnValue(['u2', 'u3']);

    const { user } = renderWithProviders(<SeenByTooltip {...defaultProps()} />);

    const indicator = screen.getByTestId('VisibilityIcon').closest('span')!;
    await user.hover(indicator);

    await waitFor(() => {
      expect(screen.getByText('Seen by 2')).toBeInTheDocument();
    });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
});
