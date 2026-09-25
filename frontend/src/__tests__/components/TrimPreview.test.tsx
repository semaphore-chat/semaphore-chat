import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { TrimPreview } from '../../components/Voice/TrimPreview';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

interface MockHlsInstance {
  loadSource: ReturnType<typeof vi.fn>;
  attachMedia: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

// Every `new Hls()` TrimPreview makes, in order.
const hls = vi.hoisted(() => ({ instances: [] as MockHlsInstance[] }));

vi.mock('hls.js', () => {
  class MockHls {
    static isSupported() {
      return true;
    }
    static Events = {
      MANIFEST_PARSED: 'hlsManifestParsed',
      ERROR: 'hlsError',
      FRAG_LOADED: 'hlsFragLoaded',
    };
    loadSource = vi.fn();
    attachMedia = vi.fn();
    on = vi.fn();
    destroy = vi.fn();
    constructor() {
      hls.instances.push(this);
    }
  }
  return { default: MockHls };
});

const BASE_URL = 'http://localhost:3000';

/** Serve session info; each request takes the next duration (the last one repeats). */
function mockSessionInfo(...durations: number[]) {
  const queue = [...durations];
  server.use(
    http.get(`${BASE_URL}/api/livekit/replay/session-info`, () => {
      const totalDurationSeconds = queue.length > 1 ? queue.shift()! : queue[0];
      return HttpResponse.json({ hasActiveSession: true, totalDurationSeconds });
    }),
  );
}

describe('TrimPreview', () => {
  beforeEach(() => {
    hls.instances.length = 0;
  });

  it('creates the HLS player exactly once, after the first duration snapshot', async () => {
    mockSessionInfo(120);
    const onRangeChange = vi.fn();
    renderWithProviders(<TrimPreview onRangeChange={onRangeChange} />);

    expect(await screen.findByLabelText('Replay buffer preview')).toBeInTheDocument();
    await waitFor(() => expect(hls.instances).toHaveLength(1));
    expect(hls.instances[0].loadSource).toHaveBeenCalledWith(
      expect.stringContaining('/livekit/replay/preview/playlist.m3u8'),
    );
    expect(hls.instances[0].attachMedia).toHaveBeenCalledWith(
      screen.getByLabelText('Replay buffer preview'),
    );
    // Default range: the last 60 seconds of the buffer.
    expect(onRangeChange).toHaveBeenCalledWith(60, 120);

    // Nothing else re-creates it while the user trims.
    await new Promise((r) => setTimeout(r, 50));
    expect(hls.instances).toHaveLength(1);
    expect(hls.instances[0].destroy).not.toHaveBeenCalled();
  });

  it('does not create a player while the buffer has no duration yet', async () => {
    mockSessionInfo(0);
    renderWithProviders(<TrimPreview onRangeChange={vi.fn()} />);

    expect(await screen.findByText(/Getting your replay ready/)).toBeInTheDocument();
    expect(hls.instances).toHaveLength(0);
  });

  it('"Refresh segments" grows the buffer and reloads the player once', async () => {
    mockSessionInfo(120, 150);
    const onRangeChange = vi.fn();
    const { user } = renderWithProviders(<TrimPreview onRangeChange={onRangeChange} />);

    await waitFor(() => expect(hls.instances).toHaveLength(1));
    expect(screen.getByText(/Buffer: 2:00 total/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh segments' }));

    await waitFor(() => expect(hls.instances).toHaveLength(2));
    expect(hls.instances[0].destroy).toHaveBeenCalled();
    expect(hls.instances[1].destroy).not.toHaveBeenCalled();
    expect(screen.getByText(/Buffer: 2:30 total/)).toBeInTheDocument();
    // The end handle sat at the old maximum, so it follows the new one.
    expect(onRangeChange).toHaveBeenLastCalledWith(60, 150);

    await new Promise((r) => setTimeout(r, 50));
    expect(hls.instances).toHaveLength(2);
  });

  it('exposes the loop toggle as a switch with aria-checked', async () => {
    mockSessionInfo(120);
    const { user } = renderWithProviders(<TrimPreview onRangeChange={vi.fn()} />);

    const loop = await screen.findByRole('switch', { name: 'Toggle loop playback' });
    expect(loop).toHaveAttribute('aria-checked', 'false');

    await user.click(loop);

    expect(loop).toHaveAttribute('aria-checked', 'true');
    expect(loop).not.toHaveAttribute('aria-pressed');
  });
});
