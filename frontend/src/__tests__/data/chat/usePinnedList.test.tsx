import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';
import { createTestQueryClient, createTestWrapper } from '../../test-utils';
import { pinnedJumpTarget, pinnedText, usePinnedList } from '../../../data/chat/usePinnedList';

vi.mock('../../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const canUnpin = vi.hoisted(() => ({ value: true }));
vi.mock('../../../features/roles/useUserPermissions', () => ({ useCanPerformAction: () => canUnpin.value }));

const API = 'http://localhost:3000/api';

describe('pinnedJumpTarget', () => {
  it('a message jumps to itself; a thread reply to its parent, with the thread to open', () => {
    expect(pinnedJumpTarget({ id: 'm1', parentMessageId: null })).toEqual({ highlight: 'm1' });
    expect(pinnedJumpTarget({ id: 'r1', parentMessageId: 'p1' })).toEqual({ highlight: 'p1', thread: 'p1' });
  });
});

describe('pinnedText', () => {
  it("joins the spans' words with spaces, skipping spans without words", () => {
    expect(pinnedText({ spans: [{ type: 'PLAINTEXT', text: 'hello' }, { type: 'USER_MENTION', userId: 'u' }, { type: 'PLAINTEXT', text: 'there' }] as never })).toBe(
      'hello there',
    );
  });
});

describe('usePinnedList', () => {
  it('lists the pins; Unpin refreshes the list once the server has it', async () => {
    let pins = [{ id: 'm1' }, { id: 'm2' }];
    const unpinned = vi.fn();
    server.use(
      http.get(`${API}/moderation/pins/:channelId`, () => HttpResponse.json(pins.map((p) => ({ ...p, spans: [], attachments: [], parentMessageId: null })))),
      http.delete(`${API}/moderation/pin/:messageId`, ({ params }) => {
        unpinned(params.messageId);
        pins = pins.filter((p) => p.id !== params.messageId);
        return HttpResponse.json({ success: true });
      }),
    );
    const { result } = renderHook(() => usePinnedList('ch-1', 'c-1'), {
      wrapper: createTestWrapper({ queryClient: createTestQueryClient() }),
    });
    await waitFor(() => expect(result.current.pins?.map((p) => p.id)).toEqual(['m1', 'm2']));
    expect(result.current.canUnpin).toBe(true);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.unpin('m1');
    });
    expect(ok).toBe(true);
    expect(unpinned).toHaveBeenCalledWith('m1');
    await waitFor(() => expect(result.current.pins?.map((p) => p.id)).toEqual(['m2']));
  });

  it('a refused Unpin resolves false', async () => {
    server.use(
      http.get(`${API}/moderation/pins/:channelId`, () => HttpResponse.json([])),
      http.delete(`${API}/moderation/pin/:messageId`, () => new HttpResponse(null, { status: 403 })),
    );
    const { result } = renderHook(() => usePinnedList('ch-1', 'c-1'), {
      wrapper: createTestWrapper({ queryClient: createTestQueryClient() }),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.unpin('m1');
    });
    expect(ok).toBe(false);
  });
});
