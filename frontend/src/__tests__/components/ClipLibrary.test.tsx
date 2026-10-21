import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { ClipLibrary } from '../../components/Profile/ClipLibrary';
import type { ClipResponseDto } from '../../api-client/types.gen';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../hooks/useVideoUrl', () => ({
  useVideoUrl: (fileId: string | null) => ({
    url: fileId ? `blob:http://localhost/video-${fileId}` : null,
    isLoading: false,
    refresh: vi.fn(),
  }),
}));

const token = vi.hoisted(() => ({ value: 'access-token' as string | null }));
vi.mock('../../utils/tokenService', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAccessToken: () => token.value,
}));

const OWN_CLIPS_URL = 'http://localhost:3000/api/livekit/clips';
const PUBLIC_CLIPS_URL = 'http://localhost:3000/api/livekit/clips/user/:userId';
const CLIP_URL = 'http://localhost:3000/api/livekit/clips/:clipId';

function makeClip(overrides: Partial<ClipResponseDto> = {}): ClipResponseDto {
  return {
    id: 'clip-1',
    fileId: 'file-1',
    channelId: 'channel-1',
    durationSeconds: 65,
    isPublic: false,
    capturedAt: '2025-04-05T15:30:00Z',
    downloadUrl: '/file/file-1',
    sizeBytes: 2048,
    filename: 'raid-boss.mp4',
    ...overrides,
  };
}

function serveOwnClips(clips: ClipResponseDto[]) {
  server.use(http.get(OWN_CLIPS_URL, () => HttpResponse.json(clips)));
}

function servePublicClips(clips: ClipResponseDto[]) {
  server.use(http.get(PUBLIC_CLIPS_URL, () => HttpResponse.json(clips)));
}

describe('ClipLibrary', () => {
  let fileRequests: Request[] = [];

  function serveDownload() {
    fileRequests = [];
    server.use(
      http.get('http://localhost:3000/api/file/:fileId', ({ request }) => {
        fileRequests.push(request);
        return new HttpResponse(new Blob(['clip-bytes']));
      }),
    );
  }

  beforeEach(() => {
    token.value = 'access-token';
    fileRequests = [];
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:download'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the own-library skeletons while loading', async () => {
    server.use(
      http.get(OWN_CLIPS_URL, async () => {
        await delay('infinite');
        return HttpResponse.json([]);
      }),
    );

    const { container } = renderWithProviders(<ClipLibrary userId="me" isOwnProfile />);

    expect(screen.getByText('My Clip Library')).toBeInTheDocument();
    expect(container.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
  });

  it('shows an error alert when the clips cannot be loaded', async () => {
    server.use(http.get(OWN_CLIPS_URL, () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<ClipLibrary userId="me" isOwnProfile />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load clips');
  });

  it('explains how to get clips when the own library is empty', async () => {
    serveOwnClips([]);

    renderWithProviders(<ClipLibrary userId="me" isOwnProfile />);

    expect(await screen.findByText('No clips yet')).toBeInTheDocument();
    expect(
      screen.getByText('Capture a replay while screen sharing to save your best moments.'),
    ).toBeInTheDocument();
  });

  it('explains when another user has no public clips', async () => {
    servePublicClips([]);

    renderWithProviders(<ClipLibrary userId="other" isOwnProfile={false} />);

    expect(await screen.findByText('This user has no public clips to show.')).toBeInTheDocument();
  });

  it('renders the own clip cards with a playable video, metadata and actions', async () => {
    serveOwnClips([
      makeClip(),
      makeClip({ id: 'clip-2', fileId: 'file-2', durationSeconds: 45, filename: 'quick.mp4' }),
    ]);
    const { container } = renderWithProviders(<ClipLibrary userId="me" isOwnProfile />);

    expect(await screen.findByText('raid-boss.mp4')).toBeInTheDocument();
    expect(screen.queryAllByText(/^1m 5s$|^45s$/)).toHaveLength(2);
    expect(screen.getAllByText('2 KB')).toHaveLength(2);
    const video = screen.getByLabelText('Video clip: raid-boss.mp4') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('blob:http://localhost/video-file-1');
    expect(container.querySelectorAll('video')).toHaveLength(2);
    expect(screen.getByLabelText('Download raid-boss.mp4')).toBeInTheDocument();
    expect(screen.getByLabelText('Share raid-boss.mp4')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete raid-boss.mp4')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(screen.getAllByRole('switch')[0]).not.toBeChecked();
    expect(screen.getAllByText('Private')).toHaveLength(2);
  });

  it('renders public clips read-only, with the clip count', async () => {
    servePublicClips([makeClip({ isPublic: true })]);

    renderWithProviders(<ClipLibrary userId="other" isOwnProfile={false} />);

    expect(await screen.findByText('Public Clips')).toBeInTheDocument();
    expect(await screen.findByText('1 public clip')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Share raid-boss.mp4')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete raid-boss.mp4')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Download raid-boss.mp4')).toBeInTheDocument();
  });

  it('pluralises the public clip count', async () => {
    servePublicClips([makeClip({ id: 'a' }), makeClip({ id: 'b', filename: 'second.mp4' })]);

    renderWithProviders(<ClipLibrary userId="other" isOwnProfile={false} />);

    expect(await screen.findByText('2 public clips')).toBeInTheDocument();
  });

  it('makes a clip public and confirms it', async () => {
    let updateBody: unknown;
    server.use(
      http.get(OWN_CLIPS_URL, () => HttpResponse.json([makeClip()])),
      http.put(CLIP_URL, async ({ request }) => {
        updateBody = await request.json();
        return HttpResponse.json({ ...makeClip(), isPublic: true });
      }),
    );

    const { user } = renderWithProviders(<ClipLibrary userId="me" isOwnProfile />);

    await user.click(await screen.findByRole('switch'));

    await waitFor(() => expect(updateBody).toEqual({ isPublic: true }));
    expect(await screen.findByText('Clip is now visible on your profile')).toBeInTheDocument();
  });

  it('makes a public clip private and reports API failures', async () => {
    server.use(
      http.get(OWN_CLIPS_URL, () => HttpResponse.json([makeClip({ isPublic: true })])),
      http.put(CLIP_URL, () =>
        HttpResponse.json({ message: 'Clip is locked' }, { status: 409 }),
      ),
    );

    const { user } = renderWithProviders(<ClipLibrary userId="me" isOwnProfile />);

    await user.click(await screen.findByRole('switch'));
    expect(screen.getByText('Visible on profile')).toBeInTheDocument();

    expect(await screen.findByText('Clip is locked')).toBeInTheDocument();
  });

  it('downloads the clip with the bearer token', async () => {
    serveOwnClips([makeClip()]);
    serveDownload();

    const { user } = renderWithProviders(<ClipLibrary userId="me" isOwnProfile />);

    await user.click(await screen.findByLabelText('Download raid-boss.mp4'));

    await waitFor(() => expect(fileRequests).toHaveLength(1));
    expect(fileRequests[0].url).toBe('http://localhost:3000/api/file/file-1');
    expect(fileRequests[0].headers.get('Authorization')).toBe('Bearer access-token');
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it('refuses to download when signed out', async () => {
    token.value = null;
    serveOwnClips([makeClip()]);
    serveDownload();

    const { user } = renderWithProviders(<ClipLibrary userId="me" isOwnProfile />);

    await user.click(await screen.findByLabelText('Download raid-boss.mp4'));

    expect(await screen.findByText('Not authenticated')).toBeInTheDocument();
    expect(fileRequests).toHaveLength(0);
  });

  it('reports a failed download', async () => {
    server.use(http.get('http://localhost:3000/api/file/:fileId', () =>
      new HttpResponse(null, { status: 503, statusText: 'Service Unavailable' }),
    ));
    serveOwnClips([makeClip()]);

    const { user } = renderWithProviders(<ClipLibrary userId="me" isOwnProfile />);

    await user.click(await screen.findByLabelText('Download raid-boss.mp4'));

    expect(
      await screen.findByText('Download failed: 503 Service Unavailable'),
    ).toBeInTheDocument();
  });

  it('deletes a clip after confirmation', async () => {
    let deleteCalls = 0;
    server.use(
      http.get(OWN_CLIPS_URL, () => HttpResponse.json([makeClip()])),
      http.delete(CLIP_URL, () => {
        deleteCalls += 1;
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = renderWithProviders(<ClipLibrary userId="me" isOwnProfile />);

    await user.click(await screen.findByLabelText('Delete raid-boss.mp4'));
    expect(screen.getByRole('heading', { name: 'Delete Clip' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteCalls).toBe(1));
    expect(await screen.findByText('Clip deleted')).toBeInTheDocument();
  });

  it('keeps the confirmation open and reports a failed delete', async () => {
    server.use(
      http.get(OWN_CLIPS_URL, () => HttpResponse.json([makeClip()])),
      http.delete(CLIP_URL, () => HttpResponse.json({ message: 'Nope' }, { status: 500 })),
    );

    const { user } = renderWithProviders(<ClipLibrary userId="me" isOwnProfile />);

    await user.click(await screen.findByLabelText('Delete raid-boss.mp4'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Nope')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delete Clip' })).toBeInTheDocument();
  });

  it('does not delete when the confirmation is cancelled', async () => {
    let deleteCalls = 0;
    server.use(
      http.get(OWN_CLIPS_URL, () => HttpResponse.json([makeClip()])),
      http.delete(CLIP_URL, () => {
        deleteCalls += 1;
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = renderWithProviders(<ClipLibrary userId="me" isOwnProfile />);

    await user.click(await screen.findByLabelText('Delete raid-boss.mp4'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Delete Clip' })).not.toBeInTheDocument(),
    );
    expect(deleteCalls).toBe(0);
  });

  it('opens the share dialog for a clip', async () => {
    serveOwnClips([makeClip()]);

    const { user } = renderWithProviders(<ClipLibrary userId="me" isOwnProfile />);

    await user.click(await screen.findByLabelText('Share raid-boss.mp4'));

    expect(screen.getByRole('heading', { name: 'Share Clip' })).toBeInTheDocument();
  });
});
