import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { generateTheme } from '../../theme/themeConfig';
import { LinkPreviewCard } from '../../components/Message/LinkPreviewCard';
import type { LinkPreview } from '../../types/message.type';

const theme = generateTheme('dark', 'blue', 'balanced');

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

function makePreview(overrides: Partial<LinkPreview> = {}): LinkPreview {
  return {
    url: 'https://example.com/article',
    title: 'Example Article',
    description: 'A description of the article.',
    siteName: 'Example',
    imageUrl: 'https://example.com/banner.jpg',
    faviconUrl: 'https://example.com/favicon.ico',
    ...overrides,
  };
}

describe('LinkPreviewCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('loads the third-party banner and favicon without sending a Referer', () => {
    const { container } = renderWithTheme(<LinkPreviewCard preview={makePreview()} />);
    const imgs = Array.from(container.querySelectorAll('img'));
    expect(imgs.map((img) => img.getAttribute('src'))).toEqual([
      'https://example.com/favicon.ico',
      'https://example.com/banner.jpg',
    ]);
    for (const img of imgs) expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('renders title, description, and site name correctly', () => {
    renderWithTheme(<LinkPreviewCard preview={makePreview()} />);

    expect(screen.getByText('Example Article')).toBeDefined();
    expect(screen.getByText('A description of the article.')).toBeDefined();
    expect(screen.getByText('Example')).toBeDefined();
  });

  it('renders banner image when imageUrl is provided', () => {
    renderWithTheme(<LinkPreviewCard preview={makePreview()} />);

    const img = screen.getByRole('img', { name: 'Example Article' });
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('https://example.com/banner.jpg');
  });

  it('does not render image when no imageUrl', () => {
    renderWithTheme(
      <LinkPreviewCard preview={makePreview({ imageUrl: undefined })} />,
    );

    expect(screen.queryByRole('img', { name: 'Example Article' })).toBeNull();
  });

  it('handles missing optional fields gracefully (no description, no siteName)', () => {
    renderWithTheme(
      <LinkPreviewCard
        preview={makePreview({
          description: undefined,
          siteName: undefined,
          faviconUrl: undefined,
        })}
      />,
    );

    // Title should still render
    expect(screen.getByText('Example Article')).toBeDefined();

    // Falls back to hostname when no siteName
    expect(screen.getByText('example.com')).toBeDefined();

    // Description should not be present
    expect(screen.queryByText('A description of the article.')).toBeNull();
  });

  it('handles missing title gracefully', () => {
    renderWithTheme(
      <LinkPreviewCard preview={makePreview({ title: undefined })} />,
    );

    // Should still render site name and description without crashing
    expect(screen.getByText('Example')).toBeDefined();
    expect(screen.getByText('A description of the article.')).toBeDefined();
  });

  it('clicking the card opens URL in new tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderWithTheme(<LinkPreviewCard preview={makePreview()} />);

    const title = screen.getByText('Example Article');
    fireEvent.click(title);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/article',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('renders favicon when faviconUrl is provided', () => {
    const { container } = renderWithTheme(
      <LinkPreviewCard preview={makePreview()} />,
    );

    const favicon = container.querySelector(
      'img[src="https://example.com/favicon.ico"]',
    );
    expect(favicon).not.toBeNull();
  });

  it('does not render favicon when faviconUrl is not provided', () => {
    const { container } = renderWithTheme(
      <LinkPreviewCard preview={makePreview({ faviconUrl: undefined })} />,
    );

    const favicon = container.querySelector(
      'img[src="https://example.com/favicon.ico"]',
    );
    expect(favicon).toBeNull();
  });

  it('hides banner image on load error', () => {
    renderWithTheme(<LinkPreviewCard preview={makePreview()} />);

    const banner = screen.getByRole('img', { name: 'Example Article' });
    expect(banner).toBeDefined();

    // Simulate image load error — component uses state to hide
    fireEvent.error(banner);

    // After error, the image should be removed from the DOM
    expect(screen.queryByRole('img', { name: 'Example Article' })).toBeNull();
  });

  it('hides broken favicon image on error', () => {
    const { container } = renderWithTheme(
      <LinkPreviewCard preview={makePreview()} />,
    );

    const favicon = container.querySelector(
      'img[src="https://example.com/favicon.ico"]',
    ) as HTMLImageElement;
    expect(favicon).not.toBeNull();

    fireEvent.error(favicon);
    expect(favicon.style.display).toBe('none');
  });
});
