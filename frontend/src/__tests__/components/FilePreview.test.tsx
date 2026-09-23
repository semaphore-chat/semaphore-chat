import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { FilePreview } from '../../components/Message/FilePreview';

const image = new File(['x'], 'photo.png', { type: 'image/png' });
const doc = new File(['x'], 'report.pdf', { type: 'application/pdf' });
const previews = new Map([[0, 'blob:preview-0']]);

describe('FilePreview', () => {
  it('renders image thumbnails and file chips, and removes by index', async () => {
    const onRemoveFile = vi.fn();
    const { user } = renderWithProviders(
      <FilePreview files={[image, doc]} previews={previews} onRemoveFile={onRemoveFile} />,
    );
    expect(screen.getByAltText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'remove photo.png' }));
    expect(onRemoveFile).toHaveBeenCalledWith(0);
  });

  it('uses 64px thumbnails, or 48px when compact (keyboard open)', () => {
    const { unmount } = renderWithProviders(
      <FilePreview files={[image]} previews={previews} onRemoveFile={vi.fn()} />,
    );
    expect(screen.getByRole('listitem')).toHaveStyle({ width: '64px', height: '64px' });
    unmount();

    renderWithProviders(<FilePreview files={[image]} previews={previews} onRemoveFile={vi.fn()} compact />);
    expect(screen.getByRole('listitem')).toHaveStyle({ width: '48px', height: '48px' });
  });

  it('does not clip the thumbnail, so the touch remove button can extend its hit area', () => {
    renderWithProviders(<FilePreview files={[image]} previews={previews} onRemoveFile={vi.fn()} />);
    expect(screen.getByRole('listitem')).not.toHaveStyle({ overflow: 'hidden' });
  });
});
