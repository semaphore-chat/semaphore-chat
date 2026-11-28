import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { AttachmentTile } from '../../kit';
import { DownloadLink } from '../../components/Message/DownloadLink';
import { downloadBlob } from '../../utils/format';
import { renderWithKit } from '../test-utils/renderWithKit';
import { renderWithProviders } from '../test-utils';
import { AudioPlayer } from '../../components/Message/AudioPlayer';
import { VideoPreview } from '../../components/Message/VideoPreview';
import { MediaViewer } from '../../kit';

vi.mock('../../contexts/AvatarCacheContext', () => ({
  useFileCache: () => ({
    getBlob: () => null,
    setBlob: () => undefined,
    hasBlob: () => false,
    fetchBlob: async () => 'blob:v',
    fetchThumbnail: async () => 'blob:t',
  }),
}));
vi.mock('../../hooks/useVideoUrl', () => ({ useVideoUrl: () => ({ url: null }) }));
vi.mock('../../hooks/useAuthenticatedFile', () => ({
  useAuthenticatedFile: () => ({ blobUrl: 'blob:x', isLoading: false, error: null }),
}));

const dirty = 'report‮gnp.exe⁦';
const clean = 'reportgnp.exe';

describe('file names drop bidi controls', () => {
  it('AttachmentTile shows and labels a file with the cleaned name', () => {
    const { container } = renderWithKit(<AttachmentTile kind="file" name={dirty} detail="1 KB" onOpen={() => {}} />);
    expect(container.textContent).toContain(clean);
    expect(container.textContent).not.toMatch(/[‪-‮⁦-⁩]/);
    expect(screen.getByRole('button').getAttribute('aria-label') ?? '').not.toMatch(/‮/);
  });

  it('AttachmentTile in an upload row labels with the cleaned name', () => {
    renderWithKit(<AttachmentTile kind="file" name={dirty} progress={0.5} onRemove={() => {}} />);
    expect(screen.getByLabelText(`Remove ${clean}`)).toBeInTheDocument();
  });

  it('DownloadLink shows the cleaned name', () => {
    const { container } = renderWithProviders(
      <DownloadLink metadata={{ id: 'f1', filename: dirty, mimeType: 'application/octet-stream', size: 10 } as never} />,
    );
    expect(container.textContent).toContain(clean);
    expect(container.textContent).not.toMatch(/‮/);
  });

  it('downloadBlob saves under the cleaned name', () => {
    let saved = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved = this.download;
    });
    downloadBlob('blob:x', dirty);
    expect(saved).toBe(clean);
    click.mockRestore();
  });

  it('the classic audio row shows the cleaned name', () => {
    const { container } = renderWithProviders(
      <AudioPlayer metadata={{ id: 'a1', filename: dirty, mimeType: 'audio/mpeg', size: 10 } as never} />,
    );
    expect(container.textContent).toContain(clean);
    expect(container.textContent).not.toMatch(/\u202E/);
  });

  it('the classic video caption and alt text use the cleaned name', async () => {
    const { container } = renderWithProviders(
      <VideoPreview metadata={{ id: 'v1', filename: dirty, mimeType: 'video/mp4', size: 10, hasThumbnail: true } as never} />,
    );
    expect(await screen.findByAltText(clean)).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/\u202E/);
  });

  it('the classic video caption (no thumbnail) uses the cleaned name', () => {
    const { container } = renderWithProviders(
      <VideoPreview metadata={{ id: 'v2', filename: dirty, mimeType: 'video/mp4', size: 10, hasThumbnail: false } as never} />,
    );
    expect(container.textContent).toContain(clean);
    expect(container.textContent).not.toMatch(/\u202E/);
  });

  it('the kit viewer heading and labels use the cleaned name', () => {
    renderWithKit(
      <MediaViewer open items={[{ src: 'blob:x', name: dirty }]} index={0} onIndexChange={() => {}} onClose={() => {}} onDownload={() => {}} />,
    );
    expect(document.body.innerHTML).not.toMatch(/\u202E/);
    expect(screen.getByLabelText(`Download ${clean}`)).toBeInTheDocument();
  });
});
