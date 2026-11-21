import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';
import { createTestQueryClient, createTestWrapper } from '../../test-utils';
import { useGifSearch } from '../../../data/chat/useGifSearch';

vi.mock('../../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const API = 'http://localhost:3000/api';

function gif(id: string) {
  return { id, title: id, url: `https://g/${id}.gif`, previewUrl: `https://g/${id}-p.gif`, width: 10, height: 10 };
}

function wrapper() {
  return createTestWrapper({ queryClient: createTestQueryClient() });
}

describe('useGifSearch', () => {
  it('a blank query lists featured GIFs (limit 20)', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/gifs/featured`, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ results: [gif('f1'), gif('f2')], next: '' });
      }),
    );
    const { result } = renderHook(() => useGifSearch('  '), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.gifs.map((g) => g.id)).toEqual(['f1', 'f2']));
    expect(seen[0].get('limit')).toBe('20');
    expect(seen[0].get('pos')).toBeNull();
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.debouncedQuery).toBe('');
  });

  it('searches the trimmed query after the 300 ms debounce', async () => {
    const searched = vi.fn();
    server.use(
      http.get(`${API}/gifs/featured`, () => HttpResponse.json({ results: [gif('f1')], next: '' })),
      http.get(`${API}/gifs/search`, ({ request }) => {
        searched(new URL(request.url).searchParams.get('q'));
        return HttpResponse.json({ results: [gif('cat1')], next: '' });
      }),
    );
    const { result, rerender } = renderHook((p: { q: string }) => useGifSearch(p.q), {
      wrapper: wrapper(),
      initialProps: { q: '' },
    });
    await waitFor(() => expect(result.current.gifs.map((g) => g.id)).toEqual(['f1']));
    rerender({ q: ' cat ' });
    expect(result.current.debouncedQuery).toBe('');
    await waitFor(() => expect(result.current.debouncedQuery).toBe('cat'));
    await waitFor(() => expect(result.current.gifs.map((g) => g.id)).toEqual(['cat1']));
    expect(searched).toHaveBeenCalledTimes(1);
    expect(searched).toHaveBeenCalledWith('cat');
  });

  it('pages with `next` as pos', async () => {
    server.use(
      http.get(`${API}/gifs/featured`, ({ request }) => {
        const pos = new URL(request.url).searchParams.get('pos');
        return pos === 'p2'
          ? HttpResponse.json({ results: [gif('b')], next: '' })
          : HttpResponse.json({ results: [gif('a')], next: 'p2' });
      }),
    );
    const { result } = renderHook(() => useGifSearch(''), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.gifs.map((g) => g.id)).toEqual(['a', 'b']));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('error state, and refetch recovers', async () => {
    let fail = true;
    server.use(
      http.get(`${API}/gifs/featured`, () =>
        fail ? HttpResponse.json({ message: 'down' }, { status: 503 }) : HttpResponse.json({ results: [gif('ok')], next: '' }),
      ),
    );
    const { result } = renderHook(() => useGifSearch(''), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.gifs).toEqual([]);
    fail = false;
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.gifs.map((g) => g.id)).toEqual(['ok']));
    expect(result.current.isError).toBe(false);
  });

  it('enabled: false fetches nothing', async () => {
    const featured = vi.fn(() => HttpResponse.json({ results: [], next: '' }));
    server.use(http.get(`${API}/gifs/featured`, featured));
    const { result } = renderHook(() => useGifSearch('', { enabled: false }), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 50));
    expect(featured).not.toHaveBeenCalled();
    expect(result.current.gifs).toEqual([]);
  });
});
