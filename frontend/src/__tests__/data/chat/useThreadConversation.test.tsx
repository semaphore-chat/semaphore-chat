import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';
import { createMessage, createTestQueryClient, createTestWrapper, createThreadReply } from '../../test-utils';
import { mergeThreadPage, useThreadConversation } from '../../../data/chat/useThreadConversation';

vi.mock('../../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const API = 'http://localhost:3000/api';

describe('mergeThreadPage', () => {
  it('appends the next page in order, skips replies already there and takes its token', () => {
    const a = createThreadReply({ id: 'a' });
    const b = createThreadReply({ id: 'b' });
    const c = createThreadReply({ id: 'c' });
    expect(mergeThreadPage({ replies: [a, b], continuationToken: 'b' }, { replies: [b, c], continuationToken: undefined })).toEqual({
      replies: [a, b, c],
      continuationToken: undefined,
    });
    expect(mergeThreadPage(undefined, { replies: [c] })).toEqual({ replies: [c] });
  });
});

describe('useThreadConversation', () => {
  function serve(fetchParent: () => void = () => undefined) {
    server.use(
      http.get(`${API}/threads/:id/replies`, ({ request }) => {
        const token = new URL(request.url).searchParams.get('continuationToken');
        if (token) return HttpResponse.json({ replies: [createThreadReply({ id: 'r3' })] });
        return HttpResponse.json({ replies: [createThreadReply({ id: 'r1' }), createThreadReply({ id: 'r2' })], continuationToken: 'r2' });
      }),
      http.get(`${API}/threads/:id/metadata`, ({ params }) =>
        HttpResponse.json({ replyCount: 3, parentMessageId: params.id, lastReplyAt: null, isSubscribed: true }),
      ),
      http.get(`${API}/messages/:id`, ({ params }) => {
        fetchParent();
        if (params.id === 'gone') return new HttpResponse(null, { status: 404 });
        return HttpResponse.json(createMessage({ id: String(params.id), channelId: 'ch-1' }));
      }),
    );
  }

  const render = (options: Parameters<typeof useThreadConversation>[0]) =>
    renderHook(() => useThreadConversation(options), { wrapper: createTestWrapper({ queryClient: createTestQueryClient() }) });

  it('loads the replies and the follow state; the next page lands in the same list', async () => {
    serve();
    const { result } = render({ parentMessageId: 'p1', parent: createMessage({ id: 'p1' }) });
    await waitFor(() => expect(result.current.replies.map((r) => r.id)).toEqual(['r1', 'r2']));
    await waitFor(() => expect(result.current.isSubscribed).toBe(true));
    expect(result.current.continuationToken).toBe('r2');
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.replies.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']));
    expect(result.current.continuationToken).toBeUndefined();
    expect(result.current.isLoadingMore).toBe(false);
  });

  it('a parent the caller has is used as is and never fetched', async () => {
    const fetched = vi.fn();
    serve(fetched);
    const parent = createMessage({ id: 'p1' });
    const { result } = render({ parentMessageId: 'p1', parent });
    expect(result.current.parent).toBe(parent);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetched).not.toHaveBeenCalled();
  });

  it('without one, the parent is fetched by id; a failed fetch is the parent error', async () => {
    serve();
    const { result } = render({ parentMessageId: 'p9', parent: null });
    expect(result.current.parentLoading).toBe(true);
    await waitFor(() => expect(result.current.parent?.id).toBe('p9'));
    const gone = render({ parentMessageId: 'gone' });
    await waitFor(() => expect(gone.result.current.parentError).toBeTruthy());
    expect(gone.result.current.parent).toBeNull();
  });
});
