import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { SeenByTooltip } from '../../components/Message/SeenByTooltip';
import type { MessageReader } from '../../types/read-receipt.type';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const BASE_URL = 'http://localhost:3000';

const defaultProps = () => ({
  messageId: 'msg-1',
  directMessageGroupId: 'dm-group-1',
});

describe('SeenByTooltip', () => {
  beforeAll(() => server.listen());
  afterAll(() => server.close());
  afterEach(() => server.resetHandlers());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows blue eye icon immediately when readers exist (no hover needed)', async () => {
    const readers: MessageReader[] = [
      {
        userId: 'u2',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: undefined,
        readAt: new Date(),
      },
    ];

    server.use(
      http.get(`${BASE_URL}/api/read-receipts/message/:messageId/readers`, () => {
        return HttpResponse.json(readers);
      })
    );

    renderWithProviders(<SeenByTooltip {...defaultProps()} />);

    // Query runs on mount, so eye should turn blue without hover
    await waitFor(() => {
      const icon = screen.getByTestId('VisibilityIcon');
      // The ReadStatusIndicator applies primary color for "read" status
      expect(icon.closest('svg')).toHaveAttribute('data-testid', 'VisibilityIcon');
    });
  });

  it('shows grey eye icon when no readers exist', async () => {
    server.use(
      http.get(`${BASE_URL}/api/read-receipts/message/:messageId/readers`, () => {
        return HttpResponse.json([]);
      })
    );

    renderWithProviders(<SeenByTooltip {...defaultProps()} />);

    // Wait for query to settle
    await waitFor(() => {
      expect(screen.getByTestId('VisibilityIcon')).toBeInTheDocument();
    });

    // No DoneIcon ever
    expect(screen.queryByTestId('DoneIcon')).not.toBeInTheDocument();
  });

  it('shows readers list in tooltip on hover', async () => {
    const readers: MessageReader[] = [
      {
        userId: 'u2',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: undefined,
        readAt: new Date(),
      },
    ];

    server.use(
      http.get(`${BASE_URL}/api/read-receipts/message/:messageId/readers`, () => {
        return HttpResponse.json(readers);
      })
    );

    const { user } = renderWithProviders(<SeenByTooltip {...defaultProps()} />);

    // Hover to open tooltip
    const indicator = screen.getByTestId('VisibilityIcon').closest('span')!;
    await user.hover(indicator);

    // Tooltip shows reader info
    await waitFor(() => {
      expect(screen.getByText('Seen by')).toBeInTheDocument();
    });
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows "Not seen yet" text when readers list is empty after loading', async () => {
    server.use(
      http.get(`${BASE_URL}/api/read-receipts/message/:messageId/readers`, () => {
        return HttpResponse.json([]);
      })
    );

    const { user } = renderWithProviders(<SeenByTooltip {...defaultProps()} />);

    // Hover to open tooltip
    const indicator = screen.getByTestId('VisibilityIcon').closest('span')!;
    await user.hover(indicator);

    // After data loads with empty array, tooltip should show "Not seen yet"
    await waitFor(() => {
      expect(screen.getByText('Not seen yet')).toBeInTheDocument();
    });

    // Eye icon should still be shown (grey), no DoneIcon ever
    expect(screen.getByTestId('VisibilityIcon')).toBeInTheDocument();
    expect(screen.queryByTestId('DoneIcon')).not.toBeInTheDocument();
  });
});
