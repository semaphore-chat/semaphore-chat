import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, within } from '@testing-library/react';
import { renderWithProviders, createMessage, createFileMetadata } from '../test-utils';
import { runAxe, expectNoAxeViolations } from '../test-utils/a11y';

const retryAttachment = vi.fn(async () => {});
const removeAttachment = vi.fn(async () => {});
const startAttachmentUploads = vi.fn();
vi.mock('../../utils/attachmentSend', () => ({
  retryAttachment: (...args: unknown[]) => retryAttachment(...(args as [])),
  removeAttachment: (...args: unknown[]) => removeAttachment(...(args as [])),
  startAttachmentUploads: (...args: unknown[]) => startAttachmentUploads(...(args as [])),
}));

import { PendingAttachments } from '../../components/Message/PendingAttachments';
import {
  setPendingUpload,
  updatePendingFile,
  resetPendingUploadsForTests,
  type PendingFile,
  type PendingUpload,
} from '../../utils/pendingUploadStore';
import type { Message } from '../../types/message.type';

function pendingFile(overrides: Partial<PendingFile> & { localId: string; name: string }): PendingFile {
  return {
    file: new File(['x'], overrides.name),
    size: 2 * 1024 * 1024,
    mimeType: 'application/pdf',
    previewUrl: null,
    status: 'uploading',
    progress: 0,
    fileId: null,
    error: null,
    ...overrides,
  };
}

function seed(entry: Partial<PendingUpload> & { files: PendingFile[] }): PendingUpload {
  const full: PendingUpload = { clientId: 'pending-1', messageId: 'msg-1', hasText: true, ...entry };
  setPendingUpload(full);
  return full;
}

function message(overrides: Partial<Message> = {}): Message {
  return createMessage({ id: 'msg-1', clientId: 'pending-1', attachments: [], ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => resetPendingUploadsForTests());
});

describe('PendingAttachments', () => {
  it('renders nothing for a message with no uploads', () => {
    const { container } = renderWithProviders(<PendingAttachments message={createMessage({ id: 'other' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows each file with an accessible, determinate progress bar', () => {
    seed({
      files: [
        pendingFile({ localId: 'f0', name: 'IMG_4031.png', mimeType: 'image/png', previewUrl: 'blob:thumb', progress: 0.42 }),
        pendingFile({ localId: 'f1', name: 'report.pdf', progress: 0.1 }),
      ],
    });
    renderWithProviders(<PendingAttachments message={message()} />);

    const list = screen.getByRole('list', { name: 'Attachments being uploaded' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);

    const bar = screen.getByRole('progressbar', { name: 'Uploading IMG_4031.png' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuetext', '42%');
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('860.16 KB of 2 MB')).toBeInTheDocument();
    // Local thumbnail for the image, decorative.
    expect(document.querySelector('img[src="blob:thumb"]')).not.toBeNull();
  });

  it('follows progress as the store updates, and swaps a finished file for the real attachment', () => {
    seed({ files: [pendingFile({ localId: 'f0', name: 'a.pdf', progress: 0.1 }), pendingFile({ localId: 'f1', name: 'b.pdf' })] });
    const { rerender } = renderWithProviders(<PendingAttachments message={message()} />);

    act(() => {
      updatePendingFile('pending-1', 'f0', { progress: 0.8 });
    });
    expect(screen.getByRole('progressbar', { name: 'Uploading a.pdf' })).toHaveAttribute('aria-valuenow', '80');

    act(() => {
      updatePendingFile('pending-1', 'f0', { status: 'attaching', progress: 1, fileId: 'file-a' });
    });
    expect(screen.getByRole('progressbar', { name: 'Uploading a.pdf' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('Finishing…')).toBeInTheDocument();

    // The attach landed in the message: its tile goes, the other stays.
    rerender(<PendingAttachments message={message({ attachments: [createFileMetadata({ id: 'file-a' })] })} />);
    expect(screen.queryByRole('progressbar', { name: 'Uploading a.pdf' })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Uploading b.pdf' })).toBeInTheDocument();
  });

  it('finds the entry by server id when the row has no clientId (refetched page)', () => {
    seed({ files: [pendingFile({ localId: 'f0', name: 'a.pdf' })] });
    renderWithProviders(<PendingAttachments message={createMessage({ id: 'msg-1', attachments: [] })} />);
    expect(screen.getByRole('progressbar', { name: 'Uploading a.pdf' })).toBeInTheDocument();
  });

  it('a failed file shows the error with Retry and Remove', async () => {
    seed({
      files: [pendingFile({ localId: 'f0', name: 'huge.zip', status: 'failed', error: 'File too large' })],
    });
    const { user } = renderWithProviders(<PendingAttachments message={message()} />);

    expect(screen.getByText('Upload failed: File too large')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry uploading huge.zip' }));
    expect(retryAttachment).toHaveBeenCalledWith('pending-1', 'f0');

    await user.click(screen.getByRole('button', { name: 'Remove huge.zip' }));
    expect(removeAttachment).toHaveBeenCalledWith('pending-1', 'f0');
  });

  it('Retry and Remove are reachable from the keyboard', async () => {
    seed({ files: [pendingFile({ localId: 'f0', name: 'huge.zip', status: 'failed' })] });
    const { user } = renderWithProviders(<PendingAttachments message={message()} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Retry uploading huge.zip' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(retryAttachment).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Remove huge.zip' })).toHaveFocus();
  });

  it('an uploading file can be cancelled', async () => {
    seed({ files: [pendingFile({ localId: 'f0', name: 'movie.mp4', mimeType: 'video/mp4', progress: 0.3 })] });
    const { user } = renderWithProviders(<PendingAttachments message={message()} />);
    await user.click(screen.getByRole('button', { name: 'Cancel uploading movie.mp4' }));
    expect(removeAttachment).toHaveBeenCalledWith('pending-1', 'f0');
  });

  it('files wait while the message is being sent, and say so when the send failed', () => {
    seed({ messageId: null, files: [pendingFile({ localId: 'f0', name: 'a.pdf', status: 'waiting' })] });
    const pending = message({ id: 'pending-1', sendStatus: 'pending' });
    const { rerender } = renderWithProviders(<PendingAttachments message={pending} />);
    expect(screen.getByText('Waiting to upload…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(startAttachmentUploads).not.toHaveBeenCalled();

    rerender(<PendingAttachments message={{ ...pending, sendStatus: 'failed' }} />);
    expect(screen.getByText("Not uploaded: the message wasn't sent")).toBeInTheDocument();
  });

  it('starts the uploads when the row turned into a server message without the entry knowing', () => {
    seed({ messageId: null, files: [pendingFile({ localId: 'f0', name: 'a.pdf', status: 'waiting' })] });
    renderWithProviders(<PendingAttachments message={message({ id: 'msg-9', sendStatus: undefined })} />);
    expect(startAttachmentUploads).toHaveBeenCalledWith('pending-1', 'msg-9');
  });

  it('truncates a long file name and keeps the full name in its title', () => {
    const long = 'delivery-queue-consumer-heap-dump-production-eu-west-1-2026-09-22T23-41-07Z.hprof.zip';
    seed({ files: [pendingFile({ localId: 'f0', name: long })] });
    renderWithProviders(<PendingAttachments message={message()} />);
    expect(screen.getByTitle(long)).toHaveTextContent(long);
  });

  it('has no axe violations (uploading and failed)', async () => {
    seed({
      files: [
        pendingFile({ localId: 'f0', name: 'a.png', mimeType: 'image/png', previewUrl: 'blob:a', progress: 0.5 }),
        pendingFile({ localId: 'f1', name: 'b.pdf', status: 'failed', error: 'Network error' }),
      ],
    });
    const { container } = renderWithProviders(<PendingAttachments message={message()} />);
    expectNoAxeViolations(await runAxe(container));
  });
});
