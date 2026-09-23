import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../test-utils';
import { server } from '../msw/server';
import PinnedMessagesPanel from '../../components/Moderation/PinnedMessagesPanel';
import { TOUCH_TARGETS } from '../../utils/breakpoints';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});
vi.mock('../../features/roles/useUserPermissions', () => ({
  useCanPerformAction: vi.fn(() => true),
}));

const touch = vi.hoisted(() => ({ value: true }));
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({ shouldUseTouchUI: touch.value }),
}));

describe('PinnedMessagesPanel on touch layouts', () => {
  beforeEach(() => {
    touch.value = true;
    server.use(
      http.get('http://localhost:3000/api/moderation/pins/:channelId', () => HttpResponse.json([])),
    );
  });

  it('has a 44px close button and safe-area padding', async () => {
    renderWithProviders(
      <PinnedMessagesPanel channelId="channel-1" communityId="community-1" onClose={vi.fn()} />,
    );
    await screen.findByText('No pinned messages yet.');

    const close = screen.getByRole('button', { name: 'Close pinned messages' });
    expect(close).toHaveStyle({
      minWidth: `${TOUCH_TARGETS.MINIMUM}px`,
      minHeight: `${TOUCH_TARGETS.MINIMUM}px`,
    });
    expect(screen.getByTestId('pinned-messages-panel')).toHaveStyle({
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    });
  });

  it('keeps the compact close button on desktop', async () => {
    touch.value = false;
    renderWithProviders(
      <PinnedMessagesPanel channelId="channel-1" communityId="community-1" onClose={vi.fn()} />,
    );
    await screen.findByText('No pinned messages yet.');
    expect(screen.getByRole('button', { name: 'Close pinned messages' })).not.toHaveStyle({
      minWidth: `${TOUCH_TARGETS.MINIMUM}px`,
    });
  });
});
