import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, seedAppearanceSettings } from '../test-utils';
import { generateTheme } from '../../theme/themeConfig';
import { MessageLinkPreviews } from '../../components/Message/MessageLinkPreviews';
import type { LinkPreview } from '../../types/message.type';

const theme = generateTheme('dark', 'blue', 'balanced');

function renderWithTheme(ui: React.ReactElement, loadRemoteContent = true) {
  const queryClient = createTestQueryClient();
  seedAppearanceSettings(queryClient, { loadRemoteContent });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

function makePreview(overrides: Partial<LinkPreview> = {}): LinkPreview {
  return {
    url: 'https://example.com/default',
    title: 'Default Title',
    description: 'Default description',
    siteName: 'Example',
    ...overrides,
  };
}

describe('MessageLinkPreviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when linkPreviews is undefined', () => {
    const { container } = renderWithTheme(
      <MessageLinkPreviews linkPreviews={undefined} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('returns null when linkPreviews is empty array', () => {
    const { container } = renderWithTheme(
      <MessageLinkPreviews linkPreviews={[]} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders a single LinkPreviewCard for one preview', () => {
    const previews: LinkPreview[] = [
      makePreview({
        url: 'https://example.com/one',
        title: 'First Article',
      }),
    ];

    renderWithTheme(<MessageLinkPreviews linkPreviews={previews} />);

    expect(screen.getByText('First Article')).toBeDefined();
  });

  it('renders multiple LinkPreviewCard components for multiple previews', () => {
    const previews: LinkPreview[] = [
      makePreview({
        url: 'https://example.com/one',
        title: 'First Article',
        siteName: 'Site A',
      }),
      makePreview({
        url: 'https://example.com/two',
        title: 'Second Article',
        siteName: 'Site B',
      }),
      makePreview({
        url: 'https://example.com/three',
        title: 'Third Article',
        siteName: 'Site C',
      }),
    ];

    renderWithTheme(<MessageLinkPreviews linkPreviews={previews} />);

    expect(screen.getByText('First Article')).toBeDefined();
    expect(screen.getByText('Second Article')).toBeDefined();
    expect(screen.getByText('Third Article')).toBeDefined();
    expect(screen.getByText('Site A')).toBeDefined();
    expect(screen.getByText('Site B')).toBeDefined();
    expect(screen.getByText('Site C')).toBeDefined();
  });

  it('passes the pictures through when pictures from other sites load', () => {
    const { container } = renderWithTheme(
      <MessageLinkPreviews
        linkPreviews={[makePreview({ imageUrl: 'https://example.com/banner.png', faviconUrl: 'https://example.com/icon.ico' })]}
      />,
    );

    expect(container.querySelector('img[src="https://example.com/banner.png"]')).not.toBeNull();
    expect(container.querySelector('img[src="https://example.com/icon.ico"]')).not.toBeNull();
  });

  it('with pictures from other sites off, the cards keep their words and fetch no picture or icon', () => {
    const { container } = renderWithTheme(
      <MessageLinkPreviews
        linkPreviews={[makePreview({ title: 'First Article', imageUrl: 'https://example.com/banner.png', faviconUrl: 'https://example.com/icon.ico' })]}
      />,
      false,
    );

    expect(screen.getByText('First Article')).toBeDefined();
    expect(screen.getByText('Default description')).toBeDefined();
    expect(container.querySelector('img')).toBeNull();
  });
});
