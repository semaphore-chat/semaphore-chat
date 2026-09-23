import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders, createUser } from '../test-utils';
import { MobileProfilePanel } from '../../components/Mobile/Panels/MobileProfilePanel';
import { MobileScreenContainer } from '../../components/Mobile/Screens/MobileScreenContainer';
import { TabletContentArea } from '../../components/Mobile/Tablet/TabletContentArea';
import {
  MobileNavigationProvider,
  useMobileNavigation,
} from '../../components/Mobile/Navigation/MobileNavigationContext';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../hooks/useAuthenticatedImage', () => ({
  useAuthenticatedImage: () => ({ blobUrl: null, isLoading: false, error: null }),
}));

vi.mock('../../components/Profile/ClipLibrary', () => ({
  ClipLibrary: ({ userId, isOwnProfile }: { userId: string; isOwnProfile: boolean }) => (
    <div data-testid="clip-library">
      clips:{userId}:{isOwnProfile ? 'own' : 'public'}
    </div>
  ),
}));

// The default MSW profile handler returns this user as "me".
const ME_ID = 'current-user-1';

const otherUser = createUser({
  id: 'other-user-1',
  username: 'other_person',
  displayName: 'Other Person',
  bio: 'I am somebody else',
  status: 'Out to lunch',
});

/** GET /api/users/:id — falls through for /api/users/profile. */
function usersByIdHandler() {
  return http.get('http://localhost:3000/api/users/:id', ({ params }) => {
    if (params.id === 'profile') return undefined;
    if (params.id === otherUser.id) return HttpResponse.json(otherUser);
    return HttpResponse.json({ statusCode: 404, message: 'User not found' }, { status: 404 });
  });
}

const TabProbe = () => {
  const { activeTab, state } = useMobileNavigation();
  return (
    <div data-testid="nav-probe">
      {state.currentScreen}|{activeTab}|{state.userId ?? ''}
    </div>
  );
};

function renderInShell(path: string, content: React.ReactNode) {
  return renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <MobileNavigationProvider>
            {content}
            <TabProbe />
          </MobileNavigationProvider>
        }
      />
    </Routes>,
    { routerProps: { initialEntries: [path] } },
  );
}

describe('MobileProfilePanel — viewing other users', () => {
  it("renders another user's profile without edit controls", async () => {
    server.use(usersByIdHandler());
    renderInShell('/', <MobileProfilePanel userId={otherUser.id} />);

    expect(await screen.findByRole('heading', { name: 'Other Person' })).toBeInTheDocument();
    expect(screen.getByText('@other_person')).toBeInTheDocument();
    expect(screen.getByText('I am somebody else')).toBeInTheDocument();
    expect(screen.getByText('Out to lunch')).toBeInTheDocument();
    expect(screen.getByTestId('clip-library')).toHaveTextContent('clips:other-user-1:public');
    // Back button, and no self-only actions
    expect(screen.getByLabelText('Go back')).toBeInTheDocument();
    expect(screen.queryByText('Edit Profile')).not.toBeInTheDocument();
    expect(screen.queryByText('Logout')).not.toBeInTheDocument();
    // The current user's name must not leak into someone else's profile
    expect(screen.queryByText('Test User')).not.toBeInTheDocument();
  });

  it('shows a not-found state for a user that does not exist', async () => {
    server.use(usersByIdHandler());
    renderInShell('/', <MobileProfilePanel userId="user-deleted-0000" />);

    expect(await screen.findByText('User not found')).toBeInTheDocument();
    expect(screen.queryByText('Edit Profile')).not.toBeInTheDocument();
    expect(screen.queryByText('Test User')).not.toBeInTheDocument();
  });

  it('shows a retryable error state when loading the user fails', async () => {
    server.use(
      http.get('http://localhost:3000/api/users/:id', ({ params }) =>
        params.id === 'profile'
          ? undefined
          : HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 }),
      ),
    );
    renderInShell('/', <MobileProfilePanel userId={otherUser.id} />);

    expect(await screen.findByText("Couldn't load this profile")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('User not found')).not.toBeInTheDocument();
  });

  it('shows the own profile with edit controls when userId is the current user', async () => {
    server.use(usersByIdHandler());
    renderInShell('/', <MobileProfilePanel userId={ME_ID} />);

    expect(await screen.findByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('Edit Profile')).toBeInTheDocument();
    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('shows the own profile with edit controls when no userId is given', async () => {
    renderInShell('/', <MobileProfilePanel />);

    expect(await screen.findByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('Edit Profile')).toBeInTheDocument();
  });
});

describe('Mobile navigation — /profile/:userId', () => {
  it('phone: /profile/<other> renders that user, keeping the previous tab', async () => {
    server.use(usersByIdHandler());
    renderInShell(`/profile/${otherUser.id}`, <MobileScreenContainer />);

    expect(await screen.findByRole('heading', { name: 'Other Person' })).toBeInTheDocument();
    expect(screen.queryByText('Edit Profile')).not.toBeInTheDocument();
    // Cold deep link: no previous tab, so the Profile tab is NOT claimed
    expect(screen.getByTestId('nav-probe')).toHaveTextContent('user-profile|home|other-user-1');
  });

  it('keeps the tab the user came from (Messages) highlighted on another user\'s profile', async () => {
    server.use(usersByIdHandler());
    const GoToProfile = () => {
      const navigate = useNavigate();
      return <button onClick={() => navigate(`/profile/${otherUser.id}`)}>open profile</button>;
    };
    const { user } = renderInShell('/direct-messages', <GoToProfile />);

    expect(screen.getByTestId('nav-probe')).toHaveTextContent(/^dm-list\|messages\|$/);
    await user.click(screen.getByText('open profile'));
    expect(screen.getByTestId('nav-probe')).toHaveTextContent('user-profile|messages|other-user-1');
  });

  it('phone: /profile/<me> resolves to the own profile screen with edit controls', async () => {
    server.use(usersByIdHandler());
    renderInShell(`/profile/${ME_ID}`, <MobileScreenContainer />);

    expect(await screen.findByText('Edit Profile')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('nav-probe')).toHaveTextContent(/^profile\|profile\|$/),
    );
  });

  it('tablet: /profile/<other> renders that user', async () => {
    server.use(usersByIdHandler());
    renderInShell(`/profile/${otherUser.id}`, <TabletContentArea showSidebar={false} />);

    expect(await screen.findByRole('heading', { name: 'Other Person' })).toBeInTheDocument();
    expect(screen.queryByText('Edit Profile')).not.toBeInTheDocument();
  });

  it('tablet: /profile/<missing> renders a not-found state', async () => {
    server.use(usersByIdHandler());
    renderInShell('/profile/user-deleted-0000', <TabletContentArea showSidebar={false} />);

    expect(await screen.findByText('User not found')).toBeInTheDocument();
  });
});
