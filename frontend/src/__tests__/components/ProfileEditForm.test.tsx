import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import ProfileEditForm from '../../components/Profile/ProfileEditForm';
import type {
  ProfileFormData,
  ProfileFormErrors,
  ProfilePreviewUrls,
} from '../../hooks/useProfileForm';

vi.mock('../../hooks/useAuthenticatedImage', () => ({
  useAuthenticatedImage: (fileId: string | null) => ({
    blobUrl: fileId ? `blob:http://localhost/${fileId}` : null,
    isLoading: false,
    error: null,
  }),
}));

const formData: ProfileFormData = {
  displayName: 'Alice Smith',
  avatar: null,
  banner: null,
  bio: 'Hello there',
  status: 'Shipping',
};

const previewUrls: ProfilePreviewUrls = { avatar: null, banner: null };
const formErrors: ProfileFormErrors = {};

const handlers = {
  onDisplayNameChange: vi.fn(),
  onAvatarChange: vi.fn(),
  onBannerChange: vi.fn(),
  onBioChange: vi.fn(),
  onStatusChange: vi.fn(),
};

function renderForm(overrides: {
  data?: Partial<ProfileFormData>;
  previews?: Partial<ProfilePreviewUrls>;
  errors?: ProfileFormErrors;
} = {}) {
  return renderWithProviders(
    <ProfileEditForm
      formData={{ ...formData, ...overrides.data }}
      previewUrls={{ ...previewUrls, ...overrides.previews }}
      formErrors={overrides.errors ?? formErrors}
      {...handlers}
    />,
  );
}

describe('ProfileEditForm', () => {
  beforeEach(() => {
    for (const handler of Object.values(handlers)) handler.mockReset();
  });

  it('renders the current values and helper text', () => {
    renderForm();

    expect(screen.getByLabelText(/Display Name/)).toHaveValue('Alice Smith');
    expect(screen.getByLabelText(/Status/)).toHaveValue('Shipping');
    expect(screen.getByLabelText(/About Me/)).toHaveValue('Hello there');
    expect(screen.getByText('Your display name (1-32 characters)')).toBeInTheDocument();
    expect(screen.getByText('What are you up to? (max 128 characters)')).toBeInTheDocument();
    expect(screen.getByText('11/500 characters')).toBeInTheDocument();
  });

  it('reports every field change to its handler', () => {
    renderForm();

    const displayName = screen.getByLabelText(/Display Name/);
    const status = screen.getByLabelText(/Status/);
    const bio = screen.getByLabelText(/About Me/);
    // Inputs are controlled with fixed values, so type one character each.
    fireEvent.change(displayName, { target: { value: 'Alice Smith!' } });
    fireEvent.change(status, { target: { value: 'Shipping!' } });
    fireEvent.change(bio, { target: { value: 'Hello there!' } });

    expect(handlers.onDisplayNameChange).toHaveBeenCalled();
    expect(handlers.onStatusChange).toHaveBeenCalled();
    expect(handlers.onBioChange).toHaveBeenCalled();
  });

  it('shows validation errors instead of the helper text', () => {
    renderForm({
      errors: {
        displayName: 'Display name is required',
        status: 'Status is too long',
        bio: 'Bio is too long',
      },
    });

    expect(screen.getByText('Display name is required')).toBeInTheDocument();
    expect(screen.getByText('Status is too long')).toBeInTheDocument();
    expect(screen.getByText('Bio is too long')).toBeInTheDocument();
    expect(screen.getByLabelText(/Display Name/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('previews a chosen banner from its local blob URL', () => {
    renderForm({ previews: { banner: 'blob:http://localhost/new-banner' } });

    expect(screen.getByAltText('Banner preview')).toHaveAttribute(
      'src',
      'blob:http://localhost/new-banner',
    );
    expect(screen.queryByText('Click to upload banner image')).not.toBeInTheDocument();
  });

  it('resolves an existing banner file id through the authenticated image cache', () => {
    renderForm({ previews: { banner: 'banner-file' } });

    expect(screen.getByAltText('Banner preview')).toHaveAttribute(
      'src',
      'blob:http://localhost/banner-file',
    );
  });

  it('shows the upload prompt when no banner is set', () => {
    renderForm();

    expect(screen.getByText('Click to upload banner image')).toBeInTheDocument();
    expect(screen.getByText('Recommended: 600x200px')).toBeInTheDocument();
    expect(screen.queryByAltText('Banner preview')).not.toBeInTheDocument();
  });

  it('shows the avatar initials and resolves an existing avatar file id', () => {
    const { rerender } = renderForm();

    expect(document.querySelector('.MuiAvatar-root img')).toBeNull();
    expect(screen.getByText('AL')).toBeInTheDocument();

    rerender(
      <ProfileEditForm
        formData={formData}
        previewUrls={{ ...previewUrls, avatar: 'avatar-file' }}
        formErrors={formErrors}
        {...handlers}
      />,
    );

    expect(document.querySelector('.MuiAvatar-root img')?.getAttribute('src')).toBe(
      'blob:http://localhost/avatar-file',
    );
  });

  it('passes a selected avatar or banner file to the change handlers', () => {
    renderForm();
    const avatar = new File(['avatar'], 'avatar.png', { type: 'image/png' });
    const banner = new File(['banner'], 'banner.png', { type: 'image/png' });

    fireEvent.change(document.querySelector('#avatar-upload') as HTMLInputElement, {
      target: { files: [avatar] },
    });
    fireEvent.change(document.querySelector('#banner-upload') as HTMLInputElement, {
      target: { files: [banner] },
    });

    expect(handlers.onAvatarChange).toHaveBeenCalledTimes(1);
    expect(handlers.onBannerChange).toHaveBeenCalledTimes(1);
  });
});
