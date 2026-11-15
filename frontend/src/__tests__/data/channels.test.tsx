import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { createTestQueryClient, createTestWrapper, createChannel } from '../test-utils';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

import { useCommunityChannels, sortCommunityChannels } from '../../data/channels';
import { handleChannelCreated } from '../../socket-hub/handlers/communityHandlers';

const BASE = 'http://localhost:3000';

const general = createChannel({ id: 'general', name: 'general', type: 'TEXT', position: 1 });
const rules = createChannel({ id: 'rules', name: 'rules', type: 'TEXT', position: 0 });
const memes = createChannel({ id: 'memes', name: 'memes', type: 'TEXT', position: 2 });
const lounge = createChannel({ id: 'lounge', name: 'Lounge', type: 'VOICE', position: 1 });
const squad = createChannel({ id: 'squad', name: 'Squad Up', type: 'VOICE', position: 0 });

describe('sortCommunityChannels', () => {
  it('splits by type and sorts each by position', () => {
    const { text, voice } = sortCommunityChannels([memes, lounge, general, squad, rules]);
    expect(text.map((c) => c.id)).toEqual(['rules', 'general', 'memes']);
    expect(voice.map((c) => c.id)).toEqual(['squad', 'lounge']);
  });

  it('keeps the server order for equal or missing positions', () => {
    const a = { ...createChannel({ id: 'a', type: 'TEXT' }), position: undefined as unknown as number };
    const b = createChannel({ id: 'b', type: 'TEXT', position: 0 });
    expect(sortCommunityChannels([a, b]).text.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('is empty before the channels load', () => {
    expect(sortCommunityChannels(undefined)).toEqual({ text: [], voice: [] });
  });
});

describe('useCommunityChannels', () => {
  it('reads the community channel list and sorts it', async () => {
    server.use(http.get(`${BASE}/api/channels/community/c-1`, () => HttpResponse.json([memes, squad, general, lounge, rules])));
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useCommunityChannels('c-1'), { wrapper: createTestWrapper({ queryClient }) });

    expect(result.current.status).toBe('pending');
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.text.map((c) => c.name)).toEqual(['rules', 'general', 'memes']);
    expect(result.current.voice.map((c) => c.name)).toEqual(['Squad Up', 'Lounge']);
    expect(result.current.all).toHaveLength(5);
  });

  it('refetches when the channel-created socket event arrives', async () => {
    let channels = [general];
    server.use(http.get(`${BASE}/api/channels/community/c-1`, () => HttpResponse.json(channels)));
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useCommunityChannels('c-1'), { wrapper: createTestWrapper({ queryClient }) });
    await waitFor(() => expect(result.current.text).toHaveLength(1));

    channels = [general, rules];
    act(() => {
      handleChannelCreated({} as never, queryClient);
    });

    await waitFor(() => expect(result.current.text.map((c) => c.id)).toEqual(['rules', 'general']));
  });

  it('reports an error and retries', async () => {
    let fail = true;
    server.use(
      http.get(`${BASE}/api/channels/community/c-1`, () =>
        fail ? HttpResponse.json({ message: 'nope' }, { status: 500 }) : HttpResponse.json([general]),
      ),
    );
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useCommunityChannels('c-1'), { wrapper: createTestWrapper({ queryClient }) });
    await waitFor(() => expect(result.current.status).toBe('error'));

    fail = false;
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.text).toHaveLength(1);
  });
});
