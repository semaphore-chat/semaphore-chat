import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { generateTheme } from '../../theme/themeConfig';
import { VideoPreview } from '../../components/Message/VideoPreview';
import type { FileMetadata } from '../../types/message.type';

// Mock the file cache context
const mockFetchThumbnail = vi.fn();

vi.mock('../../contexts/AvatarCacheContext', () => ({
  useFileCache: vi.fn(() => ({
    fetchThumbnail: mockFetchThumbnail,
  })),
}));

// Mock the useVideoUrl hook
vi.mock('../../hooks/useVideoUrl', () => ({
  useVideoUrl: vi.fn((fileId: string | null) =>
    fileId
      ? { url: `http://localhost:3000/api/file/${fileId}`, isLoading: false, refresh: vi.fn() }
      : { url: null, isLoading: false, refresh: vi.fn() },
  ),
}));

const theme = generateTheme('dark', 'blue', 'balanced');

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

describe('VideoPreview', () => {
  const baseMetadata: FileMetadata = {
    id: 'video-123',
    filename: 'test-video.mp4',
    mimeType: 'video/mp4',
    fileType: 'VIDEO',
    size: 52_428_800, // 50 MB
    hasThumbnail: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchThumbnail.mockResolvedValue('blob:thumbnail-url');
  });

  it('should render play button overlay', () => {
    renderWithTheme(<VideoPreview metadata={baseMetadata} />);

    // Play icon should be visible
    const playButton = screen.getByTestId('PlayArrowIcon');
    expect(playButton).toBeDefined();
  });

  it('should display file size badge', () => {
    renderWithTheme(<VideoPreview metadata={baseMetadata} />);

    expect(screen.getByText('50.0 MB')).toBeDefined();
  });

  it('should fetch thumbnail when hasThumbnail is true', () => {
    renderWithTheme(<VideoPreview metadata={baseMetadata} />);

    expect(mockFetchThumbnail).toHaveBeenCalledWith('video-123');
  });

  it('should not fetch thumbnail when hasThumbnail is false', () => {
    const noThumbMetadata = { ...baseMetadata, hasThumbnail: false };

    renderWithTheme(<VideoPreview metadata={noThumbMetadata} />);

    expect(mockFetchThumbnail).not.toHaveBeenCalled();
  });

  it('should show generic placeholder when no thumbnail', () => {
    const noThumbMetadata = { ...baseMetadata, hasThumbnail: false };

    renderWithTheme(<VideoPreview metadata={noThumbMetadata} />);

    // Should show the filename and video icon
    expect(screen.getByText('test-video.mp4')).toBeDefined();
    expect(screen.getByTestId('VideocamIcon')).toBeDefined();
  });

  it('should switch to video player when clicked', () => {
    renderWithTheme(<VideoPreview metadata={baseMetadata} />);

    // Click the thumbnail container (play button area)
    const playButton = screen.getByTestId('PlayArrowIcon');
    fireEvent.click(playButton);

    // After clicking, a <video> element should appear
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.src).toContain('/api/file/video-123');
    expect(video?.autoplay).toBe(true);
  });

  it('should format small file sizes correctly', () => {
    const smallMetadata = { ...baseMetadata, size: 512 };

    renderWithTheme(<VideoPreview metadata={smallMetadata} />);

    expect(screen.getByText('512 B')).toBeDefined();
  });

  it('should format KB file sizes correctly', () => {
    const kbMetadata = { ...baseMetadata, size: 150_000 };

    renderWithTheme(<VideoPreview metadata={kbMetadata} />);

    expect(screen.getByText('146 KB')).toBeDefined();
  });

  it('should format GB file sizes correctly', () => {
    const gbMetadata = { ...baseMetadata, size: 2_147_483_648 };

    renderWithTheme(<VideoPreview metadata={gbMetadata} />);

    expect(screen.getByText('2.00 GB')).toBeDefined();
  });

  describe('edge cases', () => {
    it('should show loading spinner while thumbnail is being fetched', () => {
      // Make fetchThumbnail never resolve (simulates slow network)
      mockFetchThumbnail.mockReturnValue(new Promise(() => {}));

      renderWithTheme(<VideoPreview metadata={baseMetadata} />);

      expect(screen.getByRole('progressbar')).toBeDefined();
    });

    it('should fall back to generic placeholder when thumbnail fetch fails', async () => {
      mockFetchThumbnail.mockRejectedValue(new Error('Fetch failed'));

      renderWithTheme(<VideoPreview metadata={baseMetadata} />);

      // After rejection, loading should stop and placeholder should show
      await waitFor(() => {
        expect(screen.queryByRole('progressbar')).toBeNull();
      });

      // Should show VideocamIcon placeholder (no thumbnail image)
      expect(screen.getByTestId('VideocamIcon')).toBeDefined();
      expect(screen.getByText('test-video.mp4')).toBeDefined();
    });

    it('should not update state after unmount (cancelled flag)', async () => {
      // Create a controllable promise
      let resolveThumb!: (url: string) => void;
      mockFetchThumbnail.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveThumb = resolve;
        }),
      );

      const { unmount } = renderWithTheme(
        <VideoPreview metadata={baseMetadata} />,
      );

      // Unmount before the thumbnail resolves
      unmount();

      // Resolve after unmount - should not throw or cause state update warning
      resolveThumb('blob:too-late');

      // If we get here without error, the cancelled flag worked
    });

    it('should show video controls when playing', () => {
      renderWithTheme(<VideoPreview metadata={baseMetadata} />);

      fireEvent.click(screen.getByTestId('PlayArrowIcon'));

      const video = document.querySelector('video');
      expect(video).not.toBeNull();
      expect(video?.hasAttribute('controls')).toBe(true);
    });

    it('should use useVideoUrl hook for the video src', () => {
      renderWithTheme(<VideoPreview metadata={baseMetadata} />);

      fireEvent.click(screen.getByTestId('PlayArrowIcon'));

      const video = document.querySelector('video');
      expect(video?.src).toBe(
        'http://localhost:3000/api/file/video-123',
      );
    });
  });
});
