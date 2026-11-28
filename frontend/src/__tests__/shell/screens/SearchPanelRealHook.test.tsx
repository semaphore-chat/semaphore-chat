/**
 * The search panel on the real `useMessageSearch` and `useDebounce` over MSW, real timers (the chat tests fake both):
 * Enter inside the debounce window does not jump; one request per settled query; a remount with an empty cache puts
 * focus on the result once it has loaded, without saying the count again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';
import { KitProvider } from '../../../kit';
import { SearchPanel, SEARCH_DEBOUNCE_MS, freshSearchMemory, type SearchMemory } from '../../../shell/lounge/screens/chat/SearchPanel';
import { SearchScope } from '../../../hooks/useMessageSearch';
import { userControllerGetUserByIdQueryKey } from '../../../api-client/@tanstack/react-query.gen';
import { createMessage, createTestQueryClient, renderWithProviders, resetFactoryCounter } from '../../test-utils';
import { SpanType } from '../../../types/message.type';

vi.mock('../../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const announce = vi.hoisted(() => vi.fn());
vi.mock('../../../kit', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAnnounce: () => announce,
}));

const requests: string[] = [];
function answer(texts: string[]) {
  server.use(
    http.get('http://localhost:3000/api/messages/search/channel/:channelId', ({ request }) => {
      requests.push(new URL(request.url).searchParams.get('q') ?? '');
      return HttpResponse.json(
        texts.map((text, i) => createMessage({ id: `m-${i + 5}`, channelId: 'ch-1', authorId: 'u-aiko', spans: [{ type: SpanType.PLAINTEXT, text }] })),
      );
    }),
  );
}

function setup(memory: SearchMemory = freshSearchMemory(), onJump = vi.fn()) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(userControllerGetUserByIdQueryKey({ path: { id: 'u-aiko' } }), { id: 'u-aiko', username: 'aiko', displayName: 'Aiko' });
  const view = renderWithProviders(
    <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
      <SearchPanel communityId="c-1" channelId="ch-1" memory={memory} onClose={vi.fn()} onJump={onJump} />
    </KitProvider>,
    { queryClient },
  );
  return { ...view, onJump, memory };
}

describe('SearchPanel on the real search hook', () => {
  beforeEach(() => {
    resetFactoryCounter();
    requests.length = 0;
    announce.mockClear();
  });

  it('Enter inside the debounce window does not jump; one request per settled query; Enter then opens the first', async () => {
    answer(['the deploy is green', 'deploy again']);
    const { user, onJump } = setup();
    const field = screen.getByRole('searchbox', { name: 'Search messages' });
    await user.type(field, 'deploy');
    await user.keyboard('{Enter}');
    expect(onJump).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(await screen.findByRole('button', { name: /the deploy is green/ })).toBeInTheDocument();
    // Typing took far less than the window, so the settled query is the only one asked.
    expect(requests).toEqual(['deploy']);
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
    await waitFor(() => expect(announce).toHaveBeenCalledWith('2 messages found in this channel'));
    await user.click(field);
    await user.keyboard('{Enter}');
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump.mock.calls[0][0]).toMatchObject({ id: 'm-5' });
  });

  it('a remount with an empty cache puts focus on the result after loading, and does not announce the count again', async () => {
    answer(['the deploy is green', 'deploy again']);
    const memory: SearchMemory = { query: 'deploy', scope: SearchScope.Channel, focus: { result: 'm-6' } };
    setup(memory);
    const row = await screen.findByRole('button', { name: /deploy again/ });
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(memory.focus).toBeNull();
    expect(requests).toEqual(['deploy']);
    expect(announce).not.toHaveBeenCalled();
  });
});
