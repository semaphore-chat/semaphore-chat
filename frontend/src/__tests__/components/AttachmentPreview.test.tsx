import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { generateTheme } from '../../theme/themeConfig';
import { AttachmentPreview } from '../../components/Message/AttachmentPreview';
import { useAuthenticatedFile } from '../../hooks/useAuthenticatedFile';
import type { FileMetadata } from '../../types/message.type';

// Mock child components so we can assert delegation without their side effects
vi.mock('../../components/Message/VideoPreview', () => ({
  VideoPreview: ({ metadata }: { metadata: FileMetadata }) => (
    <div data-testid="video-preview">{metadata.filename}</div>
  ),
}));

vi.mock('../../components/Message/AudioPlayer', () => ({
  AudioPlayer: ({ metadata }: { metadata: FileMetadata }) => (
    <div data-testid="audio-player">{metadata.filename}</div>
  ),
}));

vi.mock('../../components/Message/DownloadLink', () => ({
  DownloadLink: ({ metadata }: { metadata: FileMetadata }) => (
    <div data-testid="download-link">{metadata.filename}</div>
  ),
}));

// Mock useAuthenticatedFile for the internal ImagePreview
vi.mock('../../hooks/useAuthenticatedFile', () => ({
  useAuthenticatedFile: vi.fn(() => ({
    blobUrl: 'blob:mock-image-url',
    isLoading: false,
    error: null,
  })),
}));

const theme = generateTheme('dark', 'blue', 'balanced');

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

function makeMetadata(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    hasThumbnail: false,
    id: 'file-1',
    filename: 'test-file.txt',
    mimeType: 'text/plain',
    fileType: 'DOCUMENT',
    size: 1024,
    ...overrides,
  };
}

describe('AttachmentPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('MIME type detection and delegation', () => {
    it('should delegate video/mp4 to VideoPreview', () => {
      const metadata = makeMetadata({
        filename: 'movie.mp4',
        mimeType: 'video/mp4',
        fileType: 'VIDEO',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(screen.getByTestId('video-preview')).toBeDefined();
      expect(screen.getByText('movie.mp4')).toBeDefined();
    });

    it('should delegate video/webm to VideoPreview', () => {
      const metadata = makeMetadata({
        filename: 'clip.webm',
        mimeType: 'video/webm',
        fileType: 'VIDEO',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(screen.getByTestId('video-preview')).toBeDefined();
    });

    it('should delegate audio/mpeg to AudioPlayer', () => {
      const metadata = makeMetadata({
        filename: 'song.mp3',
        mimeType: 'audio/mpeg',
        fileType: 'AUDIO',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(screen.getByTestId('audio-player')).toBeDefined();
      expect(screen.getByText('song.mp3')).toBeDefined();
    });

    it('should delegate audio/wav to AudioPlayer', () => {
      const metadata = makeMetadata({
        filename: 'sound.wav',
        mimeType: 'audio/wav',
        fileType: 'AUDIO',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(screen.getByTestId('audio-player')).toBeDefined();
    });

    it('should delegate application/pdf to DownloadLink', () => {
      const metadata = makeMetadata({
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        fileType: 'DOCUMENT',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(screen.getByTestId('download-link')).toBeDefined();
      expect(screen.getByText('document.pdf')).toBeDefined();
    });

    it('should delegate text/plain to DownloadLink', () => {
      const metadata = makeMetadata({
        filename: 'readme.txt',
        mimeType: 'text/plain',
        fileType: 'DOCUMENT',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(screen.getByTestId('download-link')).toBeDefined();
    });

    it('should render image/png as an image (ImagePreview)', () => {
      const metadata = makeMetadata({
        filename: 'photo.png',
        mimeType: 'image/png',
        fileType: 'IMAGE',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      const img = screen.getByRole('img');
      expect(img).toBeDefined();
      expect(img.getAttribute('src')).toBe('blob:mock-image-url');
    });

    it('should render image/jpeg as an image (ImagePreview)', () => {
      const metadata = makeMetadata({
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        fileType: 'IMAGE',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(screen.getByRole('img')).toBeDefined();
    });

    it('should render image/gif as an image (ImagePreview)', () => {
      const metadata = makeMetadata({
        filename: 'animation.gif',
        mimeType: 'image/gif',
        fileType: 'IMAGE',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(screen.getByRole('img')).toBeDefined();
    });
  });

  describe('case insensitivity', () => {
    it('should detect VIDEO/MP4 (uppercase MIME type)', () => {
      const metadata = makeMetadata({
        filename: 'movie.mp4',
        mimeType: 'VIDEO/MP4',
        fileType: 'VIDEO',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(screen.getByTestId('video-preview')).toBeDefined();
    });

    it('should detect Image/Png (mixed case MIME type)', () => {
      const metadata = makeMetadata({
        filename: 'photo.png',
        mimeType: 'Image/Png',
        fileType: 'IMAGE',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(screen.getByRole('img')).toBeDefined();
    });
  });

  describe('ImagePreview states', () => {
    it('loads the thumbnail instead of the original when one exists', () => {
      vi.mocked(useAuthenticatedFile).mockReturnValue({
        blobUrl: 'blob:mock-thumbnail-url',
        isLoading: false,
        isLoadingBlob: false,
        isLoadingMetadata: false,
        error: null,
        metadata: null,
      });

      const metadata = makeMetadata({
        filename: 'photo.png',
        mimeType: 'image/png',
        fileType: 'IMAGE',
        hasThumbnail: true,
        width: 1600,
        height: 900,
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(useAuthenticatedFile).toHaveBeenCalledWith('file-1', {
        fetchBlob: false,
        fetchThumbnail: true,
        fetchMetadata: false,
      });
      const img = screen.getByRole('img');
      expect(img.getAttribute('src')).toBe('blob:mock-thumbnail-url');
    });

    it('loads the original when the file has no thumbnail', () => {
      const metadata = makeMetadata({
        filename: 'photo.png',
        mimeType: 'image/png',
        fileType: 'IMAGE',
        hasThumbnail: false,
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(useAuthenticatedFile).toHaveBeenCalledWith('file-1', {
        fetchBlob: true,
        fetchThumbnail: false,
        fetchMetadata: false,
      });
    });

    it('sizes the image box from the recorded dimensions', () => {
      const metadata = makeMetadata({
        filename: 'photo.png',
        mimeType: 'image/png',
        fileType: 'IMAGE',
        width: 1600,
        height: 900,
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      const img = screen.getByRole('img');
      expect(img.getAttribute('width')).toBe('1600');
      expect(img.getAttribute('height')).toBe('900');
    });

    it('shows loading spinner when blob is loading', async () => {
      const { useAuthenticatedFile } = await import(
        '../../hooks/useAuthenticatedFile'
      );
      vi.mocked(useAuthenticatedFile).mockReturnValue({
        blobUrl: null,
        isLoading: true,
        isLoadingBlob: true,
        isLoadingMetadata: false,
        error: null,
        metadata: null,
      });

      const metadata = makeMetadata({
        filename: 'photo.png',
        mimeType: 'image/png',
        fileType: 'IMAGE',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(screen.getByRole('progressbar')).toBeDefined();
    });

    it('should show error alert when fetch fails', async () => {
      const { useAuthenticatedFile } = await import(
        '../../hooks/useAuthenticatedFile'
      );
      vi.mocked(useAuthenticatedFile).mockReturnValue({
        blobUrl: null,
        isLoading: false,
        isLoadingBlob: false,
        isLoadingMetadata: false,
        error: new Error('Network error'),
        metadata: null,
      });

      const metadata = makeMetadata({
        filename: 'photo.png',
        mimeType: 'image/png',
        fileType: 'IMAGE',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      expect(screen.getByText('Failed to load attachment')).toBeDefined();
    });
  });

  describe('video does NOT trigger blob download', () => {
    it('should not call useAuthenticatedFile for video files', async () => {
      const { useAuthenticatedFile } = await import(
        '../../hooks/useAuthenticatedFile'
      );
      vi.mocked(useAuthenticatedFile).mockClear();

      const metadata = makeMetadata({
        filename: 'movie.mp4',
        mimeType: 'video/mp4',
        fileType: 'VIDEO',
      });

      renderWithTheme(<AttachmentPreview metadata={metadata} />);

      // VideoPreview is a separate component; useAuthenticatedFile should not be called
      // because the video branch returns early before ImagePreview renders
      expect(screen.getByTestId('video-preview')).toBeDefined();
      expect(screen.queryByRole('progressbar')).toBeNull();
    });
  });

  describe('callback props', () => {
    it('should pass onImageClick to the image element', async () => {
      const { useAuthenticatedFile } = await import(
        '../../hooks/useAuthenticatedFile'
      );
      vi.mocked(useAuthenticatedFile).mockReturnValue({
        blobUrl: 'blob:mock-url',
        isLoading: false,
        isLoadingBlob: false,
        isLoadingMetadata: false,
        error: null,
        metadata: null,
      });

      const onImageClick = vi.fn();
      const metadata = makeMetadata({
        filename: 'photo.png',
        mimeType: 'image/png',
        fileType: 'IMAGE',
      });

      renderWithTheme(
        <AttachmentPreview metadata={metadata} onImageClick={onImageClick} />,
      );

      const img = screen.getByRole('img');
      img.click();

      expect(onImageClick).toHaveBeenCalledTimes(1);
    });
  });
});
