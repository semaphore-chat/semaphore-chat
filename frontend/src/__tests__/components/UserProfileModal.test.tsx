import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { UserProfileModal } from '../../components/Profile/UserProfileModal';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const current = vi.hoisted(() => ({ id: 'me' as string | undefined }));
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: current.id ? { id: current.id } : null }),
}));

vi.mock('../../hooks/useAuthenticatedImage', () => ({
  useAuthenticatedImage: (fileId: string | null) => ({
    blobUrl: fileId ? `blob:http://localhost/${fileId}` : null,
    isLoading: false,
    error: null,
  }),
}));

const navigateAfterOverlays = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useOverlayHistory', () => ({
  navigateAfterOverlays,
}));

const navigation = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigation.navigate,
}));

const profile = {
  id: 'user-1',
  username: 'alice',
  displayName: 'Alice Smith',
  avatarUrl: 'avatar-file',
  bannerUrl: 'banner-file',
  bio: 'I like trains',
  status: 'Shipping',
  lastSeen: null,
  role: 'USER',
};

const defaultProps = {
  userId: 'user-1',
  open: true,
  onClose: vi.fn(),
};

function serveProfile(user = profile) {
  server.use(http.get('http://localhost:3000/api/users/:id', () => HttpResponse.json(user)));
}

describe('UserProfileModal', () => {
  beforeEach(() => {
    current.id = 'me';
    defaultProps.onClose = vi.fn();
    navigation.navigate.mockReset();
    navigateAfterOverlays.mockReset();
    // The real helper unwinds overlay history entries, then navigates.
    navigateAfterOverlays.mockImplementation((go: () => void) => go());
  });

  it('renders nothing while closed', () => {
    serveProfile();

    renderWithProviders(<UserProfileModal {...defaultProps} open={false} />);

    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
  });

  it('shows skeletons while the profile loads', async () => {
    server.use(
      http.get('http://localhost:3000/api/users/:id', async () => {
        await delay('infinite');
        return HttpResponse.json(profile);
      }),
    );

    renderWithProviders(<UserProfileModal {...defaultProps} />);

    expect(document.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
  });

  it('renders the profile details, banner and avatar', async () => {
    serveProfile();

    renderWithProviders(<UserProfileModal {...defaultProps} />);

    expect(await screen.findByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('Shipping')).toBeInTheDocument();
    expect(screen.getByText('About Me')).toBeInTheDocument();
    expect(screen.getByText('I like trains')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Message/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View Profile/ })).toBeInTheDocument();
    expect(screen.getByAltText('Profile banner')).toHaveAttribute(
      'src',
      'blob:http://localhost/banner-file',
    );
    expect(document.querySelector('.MuiAvatar-root img')?.getAttribute('src')).toBe(
      'blob:http://localhost/avatar-file',
    );
  });

  it('does not offer to message yourself', async () => {
    current.id = 'user-1';
    serveProfile();

    renderWithProviders(<UserProfileModal {...defaultProps} />);

    expect(await screen.findByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Message/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View Profile/ })).toBeInTheDocument();
  });

  it('shows the not-found message when the user does not exist', async () => {
    server.use(
      http.get('http://localhost:3000/api/users/:id', () =>
        HttpResponse.json({ statusCode: 404, message: 'Not Found' }, { status: 404 }),
      ),
    );

    renderWithProviders(<UserProfileModal {...defaultProps} />);

    expect(await screen.findByText('User not found')).toBeInTheDocument();
  });

  it('creates a direct message and opens it', async () => {
    let createBody: unknown;
    serveProfile();
    server.use(
      http.post('http://localhost:3000/api/direct-messages', async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json({
          id: 'new-dm-1',
          name: null,
          isGroup: false,
          createdAt: new Date().toISOString(),
          members: [],
        });
      }),
    );

    const { user } = renderWithProviders(<UserProfileModal {...defaultProps} />);
    await screen.findByText('Alice Smith');

    await user.click(screen.getByRole('button', { name: /Message/ }));

    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('/direct-messages/new-dm-1'));
    expect(createBody).toEqual({ userIds: ['user-1'], isGroup: false });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('stays open when creating the direct message fails', async () => {
    serveProfile();
    server.use(
      http.post('http://localhost:3000/api/direct-messages', () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 500 }),
      ),
    );

    const { user } = renderWithProviders(<UserProfileModal {...defaultProps} />);
    await screen.findByText('Alice Smith');

    await user.click(screen.getByRole('button', { name: /Message/ }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Message/ })).toBeEnabled(),
    );
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it('navigates to the full profile page and closes', async () => {
    serveProfile();

    const { user } = renderWithProviders(<UserProfileModal {...defaultProps} />);
    await screen.findByText('Alice Smith');

    await user.click(screen.getByRole('button', { name: /View Profile/ }));

    expect(defaultProps.onClose).toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith('/profile/user-1');
  });

  it('closes from the close button', async () => {
    serveProfile();

    const { user } = renderWithProviders(<UserProfileModal {...defaultProps} />);
    await screen.findByText('Alice Smith');

    await user.click(screen.getByTestId('CloseIcon').closest('button') as HTMLElement);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked', async () => {
    serveProfile();

    const { container } = renderWithProviders(<UserProfileModal {...defaultProps} />);
    await screen.findByText('Alice Smith');

    const backdrop = container.ownerDocument.querySelector('.MuiBackdrop-root') as HTMLElement;
    fireEvent.click(backdrop);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
