/** The community home's centre at compact and wide (PR 10e, finding 3): it opens the last or first text channel. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { KitProvider } from '../../../kit';
import { CommunityRedirect } from '../../../shell/lounge/screens/CommunityRedirect';
import { forgetRouteMemory, notePathname, previousPathname } from '../../../shell/routeMemory';
import { channelsControllerFindAllForCommunityQueryKey } from '../../../api-client/@tanstack/react-query.gen';
import { setLastChannelId } from '../../../utils/lastChannel';
import { mockViewport, WIDTH } from '../../kit/layout/matchMedia';
import { createChannel, createTestQueryClient, renderWithProviders } from '../../test-utils';

vi.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { id: 'u-me' } }) }));

function Where() {
  const location = useLocation();
  // As the frame does: it tells the route memory which Lounge path shows.
  useLayoutEffect(() => notePathname(location.pathname), [location.pathname]);
  return <output data-testid="where">{location.pathname}</output>;
}

function setup(channels = [
  createChannel({ id: 'ch-voice', name: 'hangout', communityId: 'c-1', type: 'VOICE', position: 0 }),
  createChannel({ id: 'ch-general', name: 'general', communityId: 'c-1', position: 1 }),
  createChannel({ id: 'ch-clips', name: 'clips', communityId: 'c-1', position: 2 }),
]) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(channelsControllerFindAllForCommunityQueryKey({ path: { communityId: 'c-1' } }), channels);
  return renderWithProviders(
    <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
      <CommunityRedirect params={{ communityId: 'c-1' }} />
      <Where />
    </KitProvider>,
    { queryClient, routerProps: { initialEntries: ['/community/c-1'] } },
  );
}

const where = () => screen.getByTestId('where').textContent;

describe('CommunityRedirect', () => {
  beforeEach(() => {
    localStorage.clear();
    forgetRouteMemory();
  });

  it('the home it replaced is not the previous Lounge path (the chat’s Back must not step back out of the app)', async () => {
    mockViewport(WIDTH.wide);
    notePathname('/community/c-0/channel/ch-9');
    setup();
    await waitFor(() => expect(where()).toBe('/community/c-1/channel/ch-general'));
    expect(previousPathname()).toBe('/community/c-0/channel/ch-9');
  });

  it('with nothing before the home, the channel has no previous path', async () => {
    mockViewport(WIDTH.wide);
    setup();
    await waitFor(() => expect(where()).toBe('/community/c-1/channel/ch-general'));
    expect(previousPathname()).toBeNull();
  });

  it('at wide opens the first text channel by position', async () => {
    mockViewport(WIDTH.wide);
    setup();
    await waitFor(() => expect(where()).toBe('/community/c-1/channel/ch-general'));
  });

  it('at compact opens the remembered channel', async () => {
    mockViewport(WIDTH.compact);
    setLastChannelId('u-me', 'c-1', 'ch-clips');
    setup();
    await waitFor(() => expect(where()).toBe('/community/c-1/channel/ch-clips'));
  });

  it('at phone width it never navigates: the home is the list, and this pane is hidden but mounted', async () => {
    mockViewport(WIDTH.phone);
    setup();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(where()).toBe('/community/c-1');
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('with no text channel it says so and stays', async () => {
    mockViewport(WIDTH.wide);
    setup([createChannel({ id: 'ch-voice', name: 'hangout', communityId: 'c-1', type: 'VOICE' })]);
    expect(await screen.findByRole('heading', { level: 1, name: 'No text channels yet' })).toBeInTheDocument();
    expect(where()).toBe('/community/c-1');
  });
});
