import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { AttachmentTile } from '../../kit';
import { DownloadLink } from '../../components/Message/DownloadLink';
import { downloadBlob } from '../../utils/format';
import { renderWithKit } from '../test-utils/renderWithKit';
import { renderWithProviders } from '../test-utils';

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
});
