import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { GifPickerPopover } from '../../components/Message/GifPicker';
import type { GifResultDto, GifSearchResponseDto } from '../../api-client/types.gen';

// vi.mock factories are hoisted above the rest of the module, so this must
// not reference the BASE_URL const declared below (TDZ) — inline the literal.
vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const BASE_URL = 'http://localhost:3000';

// Default: desktop (non-touch) so the picker renders as a Popover.
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({
    isTouchDevice: false,
    shouldUseTouchUI: false,
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    deviceType: 'desktop',
  }),
}));

function makeGif(overrides: Partial<GifResultDto> = {}): GifResultDto {
  return {
    id: 'gif-1',
    title: 'Cat jumping',
    url: 'https://media.giphy.com/1/cat.gif',
    previewUrl: 'https://media.giphy.com/1/cat-tiny.gif',
    width: 220,
    height: 140,
    mediumUrl: 'https://media.giphy.com/1/cat-medium.gif',
    mediumWidth: 160,
    mediumHeight: 102,
    mediumSizeBytes: 1048576,
    originalSizeBytes: 5242880,
    previewWidth: 100,
    previewHeight: 64,
    previewSizeBytes: 262144,
    ...overrides,
  };
}

const featuredResponse: GifSearchResponseDto = {
  results: [makeGif({ id: 'featured-1', title: 'Featured GIF' })],
  next: undefined,
};

const searchResponse: GifSearchResponseDto = {
  results: [makeGif({ id: 'search-1', title: 'Search result GIF' })],
  next: undefined,
};

describe('GifPickerPopover', () => {
  let searchRequests: URLSearchParams[];
  let featuredCalled: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    searchRequests = [];
    featuredCalled = false;

    server.use(
      http.get(`${BASE_URL}/api/gifs/featured`, () => {
        featuredCalled = true;
        return HttpResponse.json(featuredResponse);
      }),
      http.get(`${BASE_URL}/api/gifs/search`, ({ request }) => {
        const url = new URL(request.url);
        searchRequests.push(url.searchParams);
        return HttpResponse.json(searchResponse);
      }),
    );
  });

  function setup(onSelect = vi.fn()) {
    // MUI's Popover warns if anchorEl isn't laid out in the document, so use
    // a real attached element rather than document.body.
    const anchorEl = document.createElement('div');
    document.body.appendChild(anchorEl);

    const utils = renderWithProviders(
      <GifPickerPopover
        open
        anchorEl={anchorEl}
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    );
    return { ...utils, onSelect };
  }

  it('loads featured GIFs when opened with an empty search box', async () => {
    setup();

    expect(await screen.findByRole('button', { name: 'Featured GIF' })).toBeInTheDocument();
    expect(featuredCalled).toBe(true);
    expect(searchRequests).toHaveLength(0);
  });

  it('shows the Powered by GIPHY attribution while the picker is open', async () => {
    setup();

    expect(await screen.findByText('Powered by GIPHY')).toBeInTheDocument();
  });

  it('shows the Powered by GIPHY attribution even before results load', () => {
    setup();

    expect(screen.getByText('Powered by GIPHY')).toBeInTheDocument();
  });

  it('does not render anything when closed', () => {
    renderWithProviders(
      <GifPickerPopover open={false} anchorEl={null} onClose={vi.fn()} onSelect={vi.fn()} />,
    );

    expect(screen.queryByPlaceholderText('Search GIFs...')).not.toBeInTheDocument();
  });

  it('triggers a search request once the user types a query', async () => {
    const { user } = setup();

    // Wait for the initial featured load so we don't race it.
    await screen.findByRole('button', { name: 'Featured GIF' });

    await user.type(screen.getByPlaceholderText('Search GIFs...'), 'cat');

    await waitFor(() => {
      expect(searchRequests.length).toBeGreaterThan(0);
    });

    const lastRequest = searchRequests[searchRequests.length - 1];
    expect(lastRequest.get('q')).toBe('cat');

    expect(
      await screen.findByRole('button', { name: 'Search result GIF' }),
    ).toBeInTheDocument();
  });

  it('calls onSelect with the clicked gif, rendition fields included', async () => {
    const { user, onSelect } = setup();

    const gifButton = await screen.findByRole('button', { name: 'Featured GIF' });
    await user.click(gifButton);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'featured-1',
        title: 'Featured GIF',
        mediumUrl: 'https://media.giphy.com/1/cat-medium.gif',
        mediumWidth: 160,
        mediumHeight: 102,
        mediumSizeBytes: 1048576,
      }),
    );
  });
});
