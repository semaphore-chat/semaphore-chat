/**
 * The new design's shell (shell/lounge/LoungeRoot.tsx) and its marker screen:
 * the kit gets the user's appearance, the marker shows who and where, and a
 * crashing screen stays inside the shell's own boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../test-utils';
import { VoiceProvider } from '../../contexts/VoiceProvider';
import { VoiceSessionType, type VoiceState } from '../../contexts/VoiceContext';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { IncomingCallProvider } from '../../contexts/IncomingCallContext';
import { RoomContext } from '../../contexts/RoomContextDef';
import type { LoungeChoice } from '../../shell/chooseShell';
import { LOUNGE_ROUTES, type LoungeRoute } from '../../shell/loungeRoutes';

const kitProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('../../kit/theme/KitProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../kit/theme/KitProvider')>();
  return {
    ...actual,
    KitProvider: (props: Parameters<typeof actual.KitProvider>[0]) => {
      kitProps.push({ base: props.base, mode: props.mode, intensity: props.intensity });
      return actual.KitProvider(props);
    },
  };
});

vi.mock('../../hooks/useAppearance', () => ({
  useAppearance: () => ({ baseColor: '#0d9488', mode: 'light', intensity: 'vibrant', newDesign: true }),
}));

const user = vi.hoisted(() => ({
  current: { id: 'u1', username: 'alexk', displayName: 'Alex K' } as { id: string; username: string; displayName: string | null } | undefined,
}));
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: user.current, isLoading: false, isError: false }),
}));

import LoungeRoot, { LOUNGE_ROOT_MARKER } from '../../shell/lounge/LoungeRoot';

const marker = LOUNGE_ROUTES[0];

function renderLounge(choice: LoungeChoice, voiceState?: Partial<VoiceState>) {
  return renderWithProviders(
    <ErrorBoundary fallback={<div data-testid="outside-boundary" />}>
      <VoiceProvider initialState={voiceState}>
        {/* Above the new shell in the app (LayoutProviders): the banner row reads the ringing call. */}
        <RoomContext.Provider value={{ room: null, setRoom: () => undefined, getRoom: () => null }}>
          <IncomingCallProvider>
            <Routes>
              <Route path="/" element={<div data-testid="home" />} />
              <Route path="*" element={<LoungeRoot choice={choice} />} />
            </Routes>
          </IncomingCallProvider>
        </RoomContext.Provider>
      </VoiceProvider>
    </ErrorBoundary>,
    { routerProps: { initialEntries: [choice.route.path === marker.path ? '/__lounge' : '/x'] } },
  );
}

beforeEach(() => {
  kitProps.length = 0;
  user.current = { id: 'u1', username: 'alexk', displayName: 'Alex K' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoungeRoot', () => {
  it("feeds the kit the user's appearance and marks the shell", async () => {
    const { container } = renderLounge({ kind: 'lounge', route: marker, params: {} });
    await screen.findByRole('heading', { name: 'New design preview' });
    expect(kitProps[kitProps.length - 1]).toEqual({ base: '#0d9488', mode: 'light', intensity: 'vibrant' });
    const shell = container.querySelector('[data-shell="lounge"]');
    expect(shell).toHaveAttribute('data-lounge-root', LOUNGE_ROOT_MARKER);
  });

  it("a crashing screen shows the shell's own error page, not an outer boundary's", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Crashing = () => {
      throw new Error('screen crashed');
    };
    const route: LoungeRoute = {
      path: '/x',
      widths: ['wide'],
      load: async () => ({ default: { template: 'bare', Body: Crashing, useTitle: () => null } }),
    };
    renderLounge({ kind: 'lounge', route, params: {} });
    expect(await screen.findByRole('heading', { name: "Couldn't show this screen" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to the app' })).toBeInTheDocument();
    expect(screen.queryByTestId('outside-boundary')).toBeNull();
    expect(consoleError).toHaveBeenCalled();
  });

  it('passes the matched params to the screen', async () => {
    const Screen = ({ params }: { params: Record<string, string | undefined> }) => <p>{`community ${params.communityId}`}</p>;
    const route: LoungeRoute = {
      path: '/x',
      widths: ['wide'],
      load: async () => ({ default: { template: 'bare', Body: Screen, useTitle: () => null } }),
    };
    renderLounge({ kind: 'lounge', route, params: { communityId: 'c-9' } });
    expect(await screen.findByText('community c-9')).toBeInTheDocument();
  });
});

describe('the marker screen', () => {
  it('shows the display name, "Not in a call" and the way back', async () => {
    const { user: events } = renderLounge({ kind: 'lounge', route: marker, params: {} });
    expect(await screen.findByText('Alex K')).toBeInTheDocument();
    expect(screen.getByText('Not in a call')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'New design preview' })).toBeInTheDocument();
    await events.click(screen.getByRole('button', { name: 'Back to the app' }));
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument());
  });

  it('falls back to the username', async () => {
    user.current = { id: 'u1', username: 'alexk', displayName: null };
    renderLounge({ kind: 'lounge', route: marker, params: {} });
    expect(await screen.findByText('alexk')).toBeInTheDocument();
  });

  it('says which channel the call is in, from the shared voice state', async () => {
    renderLounge(
      { kind: 'lounge', route: marker, params: {} },
      {
        isConnected: true,
        contextType: VoiceSessionType.Channel,
        currentChannelId: 'ch-1',
        channelName: 'Squad Up',
        communityId: 'c-1',
      },
    );
    expect(await screen.findByText('In a call in Squad Up')).toBeInTheDocument();
  });

  it('says which direct message the call is in', async () => {
    renderLounge(
      { kind: 'lounge', route: marker, params: {} },
      { isConnected: true, contextType: VoiceSessionType.Dm, currentDmGroupId: 'dm-1', dmGroupName: 'Hangout' },
    );
    expect(await screen.findByText('In a call in Hangout')).toBeInTheDocument();
  });
});
