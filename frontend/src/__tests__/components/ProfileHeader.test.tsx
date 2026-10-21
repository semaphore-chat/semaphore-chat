import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, createUser } from '../test-utils';
import ProfileHeader from '../../components/Profile/ProfileHeader';

vi.mock('../../hooks/useAuthenticatedImage', () => ({
  useAuthenticatedImage: (fileId: string | null) => ({
    blobUrl: fileId ? `blob:http://localhost/${fileId}` : null,
    isLoading: false,
    error: null,
  }),
}));

describe('ProfileHeader', () => {
  it('renders the display name, handle, banner and avatar', () => {
    renderWithProviders(
      <ProfileHeader
        user={createUser({
          id: 'user-1',
          username: 'alice',
          displayName: 'Alice Smith',
          bannerUrl: 'banner-file',
          avatarUrl: 'avatar-file',
        })}
      />,
    );

    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();

    const banner = screen.getByAltText('Profile banner') as HTMLImageElement;
    expect(banner.src).toBe('blob:http://localhost/banner-file');

    expect(document.querySelector('.MuiAvatar-root img')?.getAttribute('src')).toBe(
      'blob:http://localhost/avatar-file',
    );
  });

  it('falls back to the username and its initials', () => {
    renderWithProviders(
      <ProfileHeader user={createUser({ username: 'bob', displayName: null })} />,
    );

    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText('@bob')).toBeInTheDocument();
    expect(screen.getByText('BO')).toBeInTheDocument();
  });

  it('shows the status chip and the bio', () => {
    renderWithProviders(
      <ProfileHeader
        user={createUser({
          username: 'alice',
          displayName: 'Alice Smith',
          status: 'Shipping',
          bio: 'First line\nSecond line',
        })}
      />,
    );

    expect(screen.getByText('Shipping')).toBeInTheDocument();
    expect(screen.getByText('About Me')).toBeInTheDocument();
    expect(screen.getByText(/First line/)).toHaveTextContent('First line Second line');
  });

  it('omits the banner image, status and bio when the user has none', () => {
    renderWithProviders(
      <ProfileHeader user={createUser({ username: 'bob', displayName: null })} />,
    );

    expect(screen.queryByAltText('Profile banner')).not.toBeInTheDocument();
    expect(screen.queryByText('About Me')).not.toBeInTheDocument();
    // Only the handle and name are present; no chip.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
