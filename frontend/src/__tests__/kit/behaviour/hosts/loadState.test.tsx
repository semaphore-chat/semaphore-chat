import { StrictMode, useLayoutEffect, useState, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { onlineManager, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import {
  Button,
  LoadState,
  Skeleton,
  useLoadState,
  useQueryLoadState,
  type LoadController,
  type UseLoadStateOptions,
} from '../../../../kit';
import { useBehaviourHost } from '../../../../kit/behaviour/hosts/hostContext';
import type { ToastRequest } from '../../../../kit';
import { ToastRegion } from '../../../../kit/display/ToastRegion';
import { OFFLINE_LOAD_MESSAGE, OFFLINE_REFRESH_MESSAGE } from '../../../../kit/behaviour/hosts/loadState';
import { server } from '../../../msw/server';
import { createTestQueryClient } from '../../../test-utils/queryClient';
import { renderWithKit } from '../../../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Records what reaches the real toast host (`useToasts().show`), and lets it through: the toast
 * queue runs as in the app. Registered in a layout effect, before the screen's own effects.
 */
function Sink({ sink }: { sink: ToastRequest[] | ((request: ToastRequest) => void) }): null {
  const host = useBehaviourHost();
  useLayoutEffect(() => {
    const toasts = host.toasts.toasts;
    const show = toasts.show.bind(toasts);
    const spy = vi.spyOn(toasts, 'show').mockImplementation((request) => {
      if (typeof sink === 'function') sink(request);
      else sink.push(request);
      return show(request);
    });
    return () => spy.mockRestore();
  }, [host, sink]);
  return null;
}

function View({ state, label = 'Members' }: { state: LoadController; label?: string }): JSX.Element {
  return (
    <>
      <span data-testid="status">{state.status}</span>
      <span data-testid="by-user">{String(state.refreshByUser)}</span>
      <Button onClick={state.refresh}>Refresh</Button>
      <LoadState
        state={state}
        label={label}
        skeleton={<Skeleton shape="text" lines={2} />}
        empty={<p>No members yet</p>}
        errorTitle="Couldn't load members"
      >
        <ul aria-label="Members list">
          <li>dropbear</li>
        </ul>
      </LoadState>
    </>
  );
}

const status = () => screen.getByTestId('status').textContent;
const flush = () => act(async () => {});

describe('useLoadState', () => {
  type Load = UseLoadStateOptions<string[]>['load'];
  function Screen(props: Partial<UseLoadStateOptions<string[]>> & { load: Load; sink?: ToastRequest[] }) {
    const { sink, ...rest } = props;
    const { state, data } = useLoadState<string[]>({
      notifyId: 'members',
      resetKey: 'a',
      isEmpty: (names) => names.length === 0,
      ...rest,
    });
    return (
      <>
        {sink && <Sink sink={(request) => sink.push(request)} />}
        <span data-testid="data">{data === undefined ? 'none' : data.join(',')}</span>
        <View state={state} />
      </>
    );
  }
  const data = () => screen.getByTestId('data').textContent;

  it('starts loading, fetches once, then shows the content and hands back the data', async () => {
    const first = deferred<string[]>();
    const load = vi.fn(() => first.promise);
    renderWithKit(<Screen load={load} />);
    expect(status()).toBe('loading');
    expect(data()).toBe('none');
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(['dropbear']));
    expect(status()).toBe('ready');
    expect(data()).toBe('dropbear');
    expect(screen.getByRole('list', { name: 'Members list' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when isEmpty says so', async () => {
    renderWithKit(<Screen load={() => Promise.resolve([])} />);
    await screen.findByText('No members yet');
    expect(status()).toBe('empty');
  });

  it('shows the error with Try again when the first load fails, and retry loads again', async () => {
    const load = vi.fn<Load>().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(['dropbear']);
    const { user } = renderWithKit(<Screen load={load} errorMessage={() => 'The server is down.'} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load members");
    expect(alert).toHaveTextContent('The server is down.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('list', { name: 'Members list' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('the default failure: the error screen has the title and Try again, and no body', async () => {
    renderWithKit(<Screen load={() => Promise.reject(new Error('500'))} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Couldn't load membersTry again");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('the default failure of a refresh is a toast that says what happened', async () => {
    const sink: ToastRequest[] = [];
    const load = vi.fn<Load>().mockResolvedValueOnce(['dropbear']).mockRejectedValueOnce(new Error('500'));
    const { user } = renderWithKit(<Screen load={load} sink={sink} />);
    await screen.findByRole('list', { name: 'Members list' });
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(sink).toHaveLength(1));
    expect(sink[0]).toEqual({ id: 'members', tone: 'danger', message: "Couldn't refresh. Try again." });
  });

  it('a background refresh keeps the content; a failed refresh notifies with the notify id and keeps the data', async () => {
    const sink: ToastRequest[] = [];
    const load = vi.fn<Load>().mockResolvedValueOnce(['dropbear']);
    const { user } = renderWithKit(<Screen load={load} sink={sink} errorMessage={() => 'You are offline.'} />);
    await screen.findByRole('list', { name: 'Members list' });
    const refreshing = deferred<string[]>();
    load.mockReturnValueOnce(refreshing.promise);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(status()).toBe('refreshing');
    expect(screen.getByRole('list', { name: 'Members list' })).toBeInTheDocument();
    expect(screen.getByTestId('by-user').textContent).toBe('true');
    await act(async () => refreshing.reject(new Error('offline')));
    expect(status()).toBe('ready');
    expect(data()).toBe('dropbear');
    expect(screen.getByTestId('by-user').textContent).toBe('false');
    expect(sink).toEqual([{ id: 'members', tone: 'danger', message: 'You are offline.' }]);
  });

  it('a failed refresh with no ToastRegion on the page queues its toast without a fault', async () => {
    const load = vi.fn<Load>().mockResolvedValueOnce(['dropbear']).mockRejectedValueOnce(new Error('x'));
    const { user } = renderWithKit(<Screen load={load} />);
    await screen.findByRole('list', { name: 'Members list' });
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await flush();
    expect(status()).toBe('ready');
  });

  it('a stale result after resetKey changes is ignored, its data dropped, and the old fetch is aborted', async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const signals: AbortSignal[] = [];
    // The load ignores its signal (an easy mistake): the hook still drops the old answer.
    const load = vi
      .fn<Load>()
      .mockImplementationOnce((signal) => {
        signals.push(signal);
        return first.promise;
      })
      .mockImplementationOnce((signal) => {
        signals.push(signal);
        return second.promise;
      });
    const { rerender } = renderWithKit(<Screen load={load} resetKey="a" />);
    expect(load).toHaveBeenCalledTimes(1);
    rerender(<Screen load={load} resetKey="b" />);
    expect(load).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    // The first answers late: neither its status nor its data shows.
    await act(async () => first.resolve(['Old channel']));
    expect(status()).toBe('loading');
    expect(data()).toBe('none');
    await act(async () => second.resolve(['pri']));
    expect(status()).toBe('ready');
    expect(data()).toBe('pri');
  });

  it('a change of resetKey never renders the old data as the new subject', async () => {
    const load = vi.fn<Load>().mockResolvedValueOnce(['dropbear']);
    const rendered: string[] = [];
    function Probe({ k }: { k: string }) {
      const { state, data: names } = useLoadState<string[]>({
        notifyId: 'members',
        resetKey: k,
        load,
        isEmpty: (n) => n.length === 0,
      });
      rendered.push(`${k}:${state.status}:${names?.join(',') ?? 'none'}`);
      return null;
    }
    const { rerender } = renderWithKit(<Probe k="a" />);
    await waitFor(() => expect(rendered[rendered.length - 1]).toBe('a:ready:dropbear'));
    load.mockReturnValueOnce(new Promise(() => {}));
    rendered.length = 0;
    rerender(<Probe k="b" />);
    expect(rendered.every((line) => line === 'b:loading:none')).toBe(true);
  });

  it('a resetKey built from ids each render is compared by value: one load', async () => {
    const load = vi.fn<Load>(() => Promise.resolve(['dropbear']));
    function Built({ community, channel }: { community: string; channel: number }) {
      const { state } = useLoadState<string[]>({
        notifyId: 'members',
        resetKey: `${community}:${channel}`,
        load,
        isEmpty: (n) => n.length === 0,
      });
      return <span data-testid="status">{state.status}</span>;
    }
    const { rerender } = renderWithKit(<Built community="couch" channel={1} />);
    await waitFor(() => expect(status()).toBe('ready'));
    rerender(<Built community="couch" channel={1} />);
    rerender(<Built community="couch" channel={1} />);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    rerender(<Built community="couch" channel={2} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('resetKey takes a string or a number only (an array would restart every render)', () => {
    const base = { notifyId: 'members', load: () => Promise.resolve([]), isEmpty: () => true };
    // @ts-expect-error an array is a new value every render
    const asArray: UseLoadStateOptions<never[]> = { ...base, resetKey: ['members', 'general'] };
    // @ts-expect-error an object is a new value every render
    const asObject: UseLoadStateOptions<never[]> = { ...base, resetKey: { channel: 'general' } };
    const ok: UseLoadStateOptions<never[]>[] = [
      { ...base, resetKey: 'general' },
      { ...base, resetKey: 7 },
    ];
    expect([asArray, asObject, ...ok]).toHaveLength(4);
  });

  it('a change of resetKey shows the skeleton again and the status "Loading members"', async () => {
    const load = vi.fn<Load>(() => Promise.resolve(['dropbear']));
    const { rerender } = renderWithKit(<Screen load={load} resetKey="a" />);
    await screen.findByRole('list', { name: 'Members list' });
    const next = deferred<string[]>();
    load.mockReturnValueOnce(next.promise);
    rerender(<Screen load={load} resetKey="b" />);
    expect(status()).toBe('loading');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Loading members');
    expect(screen.queryByRole('list', { name: 'Members list' })).not.toBeInTheDocument();
    await act(async () => next.resolve(['dropbear']));
  });

  it('aborts the fetch and ignores its result when the screen goes away', async () => {
    const pending = deferred<string[]>();
    let signal: AbortSignal | undefined;
    const view = renderWithKit(
      <Screen
        load={(s) => {
          signal = s;
          return pending.promise;
        }}
      />,
    );
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(['dropbear']));
  });

  it('a load that throws instead of rejecting is a failure', async () => {
    renderWithKit(
      <Screen
        load={() => {
          throw new Error('sync');
        }}
      />,
    );
    await screen.findByRole('alert');
    expect(status()).toBe('error');
  });

  it('under StrictMode it loads, and shows the answer of the load that counts', async () => {
    const load = vi.fn<Load>(() => Promise.resolve(['dropbear']));
    renderWithKit(
      <StrictMode>
        <Screen load={load} />
      </StrictMode>,
    );
    await screen.findByRole('list', { name: 'Members list' });
    expect(data()).toBe('dropbear');
  });
});

describe('useQueryLoadState', () => {
  const ENDPOINT = 'http://localhost:3000/members';
  let hits: number;
  let queryClient: QueryClient;

  async function getMembers(channel: string): Promise<string[]> {
    const response = await fetch(`${ENDPOINT}?channel=${channel}`);
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as string[];
  }

  interface ScreenProps {
    /** null: the id has not arrived yet. */
    channel?: string | null;
    enabled?: boolean;
    sink?: ToastRequest[];
    /** Called at each commit with the status on screen. */
    commits?: string[];
  }

  function Screen({ channel = 'general', enabled = true, sink, commits }: ScreenProps) {
    const query = useQuery({
      queryKey: ['members', channel],
      queryFn: () => getMembers(channel as string),
      enabled: enabled && channel !== null,
    });
    const state = useQueryLoadState(query, {
      notifyId: 'members',
      resetKey: channel ?? '',
      isEmpty: (members) => members.length === 0,
      errorMessage: () => "Couldn't reach the server.",
    });
    return (
      <>
        {sink && <Sink sink={(request) => sink.push(request)} />}
        {commits && <Commits status={state.status} commits={commits} />}
        <span data-testid="names">{query.data?.join(',') ?? 'none'}</span>
        <View state={state} />
      </>
    );
  }

  function Commits({ status: committed, commits }: { status: string; commits: string[] }): null {
    useLayoutEffect(() => {
      commits.push(committed);
    });
    return null;
  }

  const wrap = (ui: JSX.Element) => <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
  const renderScreen = (ui: JSX.Element) => {
    const view = renderWithKit(wrap(ui));
    return { ...view, rerender: (next: JSX.Element) => view.rerender(wrap(next)) };
  };

  function members(body: () => Response | Promise<Response>) {
    server.use(
      http.get(ENDPOINT, async () => {
        hits += 1;
        return body();
      }),
    );
  }

  beforeEach(() => {
    hits = 0;
    queryClient = createTestQueryClient();
  });
  afterEach(async () => {
    // A fetch left paused by an offline test would resume on reconnect and reach the next test's
    // handler: unmount first (RTL's own cleanup runs after this), then drop the queries, then reconnect.
    cleanup();
    await queryClient.cancelQueries();
    queryClient.clear();
    onlineManager.setOnline(true);
  });

  it('joins the query on mount: one request, not two', async () => {
    members(() => HttpResponse.json(['dropbear']));
    renderScreen(<Screen />);
    await screen.findByRole('list', { name: 'Members list' });
    await flush();
    expect(hits).toBe(1);
    expect(status()).toBe('ready');
  });

  it('shows the empty state for an empty result', async () => {
    members(() => HttpResponse.json([]));
    renderScreen(<Screen />);
    await screen.findByText('No members yet');
    expect(hits).toBe(1);
  });

  describe('a disabled query (C2)', () => {
    it('a dependent query whose id arrives later: loading, no request, then one request when it arrives', async () => {
      members(() => HttpResponse.json(['dropbear']));
      const { user, rerender } = renderScreen(<Screen channel={null} />);
      await flush();
      expect(status()).toBe('loading');
      expect(screen.queryByText('No members yet')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      // A refresh while it waits fetches nothing either.
      await user.click(screen.getByRole('button', { name: 'Refresh' }));
      await flush();
      expect(hits).toBe(0);
      rerender(<Screen channel="general" />);
      await screen.findByRole('list', { name: 'Members list' });
      expect(hits).toBe(1);
    });

    it('a query enabled later under the same resetKey (a permission) keeps the skeleton, then loads once', async () => {
      members(() => HttpResponse.json(['dropbear']));
      const { rerender } = renderScreen(<Screen enabled={false} />);
      await flush();
      expect(status()).toBe('loading');
      expect(hits).toBe(0);
      rerender(<Screen enabled />);
      await screen.findByRole('list', { name: 'Members list' });
      expect(hits).toBe(1);
    });
  });

  describe('a disabled query, more (C2)', () => {
    it('Try again while the query is disabled fetches nothing and shows the skeleton until it is enabled', async () => {
      members(() => new HttpResponse(null, { status: 500 }));
      const { user, rerender } = renderScreen(<Screen />);
      await screen.findByRole('alert');
      expect(hits).toBe(1);
      rerender(<Screen enabled={false} />);
      members(() => HttpResponse.json(['dropbear']));
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await flush();
      expect(hits).toBe(1);
      expect(status()).toBe('loading');
      rerender(<Screen enabled />);
      await screen.findByRole('list', { name: 'Members list' });
      expect(hits).toBe(2);
    });

    it('a disabled query with cached data shows it at once; Refresh fetches nothing and is not left busy', async () => {
      queryClient.setQueryData(['members', 'general'], ['dropbear']);
      const commits: string[] = [];
      const { user } = renderScreen(<Screen enabled={false} commits={commits} />);
      expect(commits[0]).toBe('ready');
      await user.click(screen.getByRole('button', { name: 'Refresh' }));
      await flush();
      expect(status()).toBe('ready');
      expect(screen.getByTestId('by-user').textContent).toBe('false');
      expect(hits).toBe(0);
    });

    it('a disabled query with cached empty data shows the empty state', async () => {
      queryClient.setQueryData(['members', 'general'], []);
      renderScreen(<Screen enabled={false} />);
      expect(status()).toBe('empty');
      expect(hits).toBe(0);
    });

    it('a disabled query with nothing cached, or only a cached error, keeps the skeleton', async () => {
      const view = renderScreen(<Screen enabled={false} />);
      await flush();
      expect(status()).toBe('loading');
      view.unmount();
      members(() => new HttpResponse(null, { status: 500 }));
      const failing = renderScreen(<Screen />);
      await screen.findByRole('alert');
      failing.unmount();
      renderScreen(<Screen enabled={false} />);
      await flush();
      expect(status()).toBe('loading');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(hits).toBe(1);
    });
  });

  describe('a cached query (I1)', () => {
    it('fresh data: the first committed render is ready, with no request', async () => {
      queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      members(() => HttpResponse.json(['dropbear']));
      const first = renderScreen(<Screen />);
      await screen.findByRole('list', { name: 'Members list' });
      expect(hits).toBe(1);
      first.unmount();
      const commits: string[] = [];
      renderScreen(<Screen commits={commits} />);
      expect(commits[0]).toBe('ready');
      await flush();
      expect(commits.every((c) => c === 'ready')).toBe(true);
      expect(hits).toBe(1);
    });

    it('fresh data for the key switched to: no skeleton is committed, no request', async () => {
      queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      server.use(
        http.get(ENDPOINT, ({ request }) => {
          hits += 1;
          return HttpResponse.json([new URL(request.url).searchParams.get('channel')]);
        }),
      );
      const commits: string[] = [];
      const { rerender } = renderScreen(<Screen channel="general" commits={commits} />);
      await screen.findByText('general');
      rerender(<Screen channel="random" commits={commits} />);
      await screen.findByText('random');
      commits.length = 0;
      rerender(<Screen channel="general" commits={commits} />);
      expect(screen.getByTestId('names').textContent).toBe('general');
      await flush();
      expect(commits).not.toContain('loading');
      expect(hits).toBe(2);
    });

    it('stale data: the cache shows at once and the refetch on mount is a background refresh', async () => {
      members(() => HttpResponse.json(['dropbear']));
      const first = renderScreen(<Screen />);
      await screen.findByRole('list', { name: 'Members list' });
      first.unmount();
      const slow = deferred<void>();
      members(async () => {
        await slow.promise;
        return HttpResponse.json(['dropbear', 'pri']);
      });
      const commits: string[] = [];
      renderScreen(<Screen commits={commits} />);
      expect(commits[0]).toBe('refreshing');
      expect(screen.getByTestId('by-user').textContent).toBe('false');
      await act(async () => slow.resolve());
      await waitFor(() => expect(status()).toBe('ready'));
      expect(commits).not.toContain('loading');
      expect(hits).toBe(2);
    });
  });

  it('a background refetch keeps the content and shows nothing on the refresh button', async () => {
    members(() => HttpResponse.json(['dropbear']));
    renderScreen(<Screen />);
    await screen.findByRole('list', { name: 'Members list' });
    const second = deferred<void>();
    members(async () => {
      await second.promise;
      return HttpResponse.json(['dropbear', 'pri']);
    });
    act(() => {
      void queryClient.invalidateQueries({ queryKey: ['members'] });
    });
    await waitFor(() => expect(status()).toBe('refreshing'));
    expect(screen.getByRole('list', { name: 'Members list' })).toBeInTheDocument();
    expect(screen.getByTestId('by-user').textContent).toBe('false');
    await act(async () => second.resolve());
    await waitFor(() => expect(status()).toBe('ready'));
    expect(hits).toBe(2);
  });

  it('a refresh the user starts refetches once and shows busy on its control', async () => {
    members(() => HttpResponse.json(['dropbear']));
    const { user } = renderScreen(<Screen />);
    await screen.findByRole('list', { name: 'Members list' });
    const second = deferred<void>();
    members(async () => {
      await second.promise;
      return HttpResponse.json(['dropbear']);
    });
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(status()).toBe('refreshing'));
    expect(screen.getByTestId('by-user').textContent).toBe('true');
    await act(async () => second.resolve());
    await waitFor(() => expect(status()).toBe('ready'));
    expect(screen.getByTestId('by-user').textContent).toBe('false');
    expect(hits).toBe(2);
  });

  it('a failed refetch keeps the content and notifies with the notify id', async () => {
    members(() => HttpResponse.json(['dropbear']));
    const sink: ToastRequest[] = [];
    renderScreen(<Screen sink={sink} />);
    await screen.findByRole('list', { name: 'Members list' });
    members(() => new HttpResponse(null, { status: 503 }));
    act(() => {
      void queryClient.invalidateQueries({ queryKey: ['members'] });
    });
    await waitFor(() => expect(sink).toHaveLength(1));
    expect(sink[0]).toEqual({ id: 'members', tone: 'danger', message: "Couldn't reach the server." });
    expect(status()).toBe('ready');
    expect(screen.getByRole('list', { name: 'Members list' })).toBeInTheDocument();
  });

  it('through the real toast region: a failed refetch shows a danger toast with the notify id', async () => {
    members(() => HttpResponse.json(['dropbear']));
    const showing = { read: (): unknown => null };
    function Probe(): null {
      const host = useBehaviourHost();
      showing.read = () => host.toasts.machine.getState().showing;
      return null;
    }
    renderWithKit(
      wrap(
        <>
          <Screen />
          <ToastRegion />
          <Probe />
        </>,
      ),
    );
    await screen.findByRole('list', { name: 'Members list' });
    members(() => new HttpResponse(null, { status: 503 }));
    act(() => {
      void queryClient.invalidateQueries({ queryKey: ['members'] });
    });
    await waitFor(() => expect(document.querySelector('[data-kit-toast-region]')).toHaveTextContent("Couldn't reach the server."));
    expect(showing.read()).toMatchObject({ id: 'members', tone: 'danger', message: "Couldn't reach the server." });
    expect(status()).toBe('ready');
  });

  it('a first failure shows the error; Try again refetches and shows the content', async () => {
    members(() => new HttpResponse(null, { status: 500 }));
    const { user } = renderScreen(<Screen />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load members");
    expect(alert).toHaveTextContent("Couldn't reach the server.");
    members(() => HttpResponse.json(['dropbear']));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('list', { name: 'Members list' });
    expect(hits).toBe(2);
  });

  it('a change of resetKey loads the new subject from scratch and ignores the old one', async () => {
    const slow = deferred<void>();
    server.use(
      http.get(ENDPOINT, async ({ request }) => {
        hits += 1;
        const channel = new URL(request.url).searchParams.get('channel');
        if (channel === 'general') {
          await slow.promise;
          return HttpResponse.json([]);
        }
        return HttpResponse.json(['dropbear']);
      }),
    );
    const view = renderScreen(<Screen channel="general" />);
    expect(status()).toBe('loading');
    view.rerender(<Screen channel="random" />);
    await screen.findByRole('list', { name: 'Members list' });
    // general answers late with an empty list: random's content stays.
    await act(async () => slow.resolve());
    await flush();
    expect(status()).toBe('ready');
    expect(hits).toBe(2);
  });

  describe('a cancelled fetch (I2), as the socket handlers do it: cancelQueries, then setQueryData', () => {
    const appendGrace = (old: string[] | undefined) => (old ? [...old, 'pri'] : old);

    it('during the first load: not a result, never the empty state; the load is resumed once and shows', async () => {
      const slow = deferred<void>();
      members(async () => {
        await slow.promise;
        return HttpResponse.json(['dropbear']);
      });
      renderScreen(<Screen />);
      expect(status()).toBe('loading');
      const resumed = deferred<void>();
      members(async () => {
        await resumed.promise;
        return HttpResponse.json(['dropbear']);
      });
      await act(async () => {
        await queryClient.cancelQueries({ queryKey: ['members', 'general'] });
        queryClient.setQueryData<string[]>(['members', 'general'], appendGrace);
      });
      await waitFor(() => expect(hits).toBe(2));
      expect(status()).toBe('loading');
      expect(screen.queryByText('No members yet')).not.toBeInTheDocument();
      await act(async () => resumed.resolve());
      await screen.findByRole('list', { name: 'Members list' });
      await act(async () => slow.resolve());
    });

    it('a second cancel of the resumed load does not resume again: no loop', async () => {
      members(() => new Promise(() => {}));
      renderScreen(<Screen />);
      for (let i = 0; i < 2; i += 1) {
        await waitFor(() => expect(hits).toBe(i + 1));
        await act(async () => {
          await queryClient.cancelQueries({ queryKey: ['members', 'general'] });
        });
      }
      await flush();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(hits).toBe(2);
      expect(status()).toBe('loading');
    });

    it('during a refresh: the content stays and the refresh ends with the data set by hand', async () => {
      members(() => HttpResponse.json(['dropbear']));
      const { user } = renderScreen(<Screen />);
      await screen.findByRole('list', { name: 'Members list' });
      const slow = deferred<void>();
      members(async () => {
        await slow.promise;
        return HttpResponse.json(['dropbear']);
      });
      await user.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(status()).toBe('refreshing'));
      await act(async () => {
        await queryClient.cancelQueries({ queryKey: ['members', 'general'] });
        queryClient.setQueryData<string[]>(['members', 'general'], appendGrace);
      });
      await waitFor(() => expect(status()).toBe('ready'));
      expect(screen.getByTestId('by-user').textContent).toBe('false');
      expect(screen.getByTestId('names').textContent).toBe('dropbear,pri');
      await act(async () => slow.resolve());
    });

    it('during a refresh, with nothing set after: the refresh ends, the content stays', async () => {
      members(() => HttpResponse.json(['dropbear']));
      const { user } = renderScreen(<Screen />);
      await screen.findByRole('list', { name: 'Members list' });
      members(() => new Promise(() => {}));
      await user.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(status()).toBe('refreshing'));
      await act(async () => {
        await queryClient.cancelQueries({ queryKey: ['members', 'general'] });
      });
      await waitFor(() => expect(status()).toBe('ready'));
      expect(screen.getByTestId('names').textContent).toBe('dropbear');
    });
  });

  describe('setQueryData with no fetch (M10)', () => {
    it('while ready: stays ready with the new data', async () => {
      members(() => HttpResponse.json(['dropbear']));
      renderScreen(<Screen />);
      await screen.findByRole('list', { name: 'Members list' });
      act(() => {
        queryClient.setQueryData<string[]>(['members', 'general'], (old) => [...(old ?? []), 'pri']);
      });
      await waitFor(() => expect(screen.getByTestId('names').textContent).toBe('dropbear,pri'));
      await flush();
      expect(status()).toBe('ready');
      expect(hits).toBe(1);
    });

    it('while empty: the first member arriving by socket makes it ready', async () => {
      members(() => HttpResponse.json([]));
      renderScreen(<Screen />);
      await screen.findByText('No members yet');
      act(() => {
        queryClient.setQueryData<string[]>(['members', 'general'], ['dropbear']);
      });
      await waitFor(() => expect(status()).toBe('ready'));
      expect(hits).toBe(1);
    });
  });

  describe('offline (I5): a paused fetch is a failed attempt', () => {
    it('a first load while offline shows the error with the offline wording and no Try again, and loads by itself when the connection returns', async () => {
      members(() => HttpResponse.json(['dropbear']));
      onlineManager.setOnline(false);
      renderScreen(<Screen />);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent("Couldn't load members");
      expect(alert).toHaveTextContent(OFFLINE_LOAD_MESSAGE);
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
      expect(hits).toBe(0);
      act(() => onlineManager.setOnline(true));
      await screen.findByRole('list', { name: 'Members list' });
      expect(hits).toBe(1);
    });

    it('a refresh the user starts while offline stops being busy and notifies with the offline wording', async () => {
      members(() => HttpResponse.json(['dropbear']));
      const sink: ToastRequest[] = [];
      const { user } = renderScreen(<Screen sink={sink} />);
      await screen.findByRole('list', { name: 'Members list' });
      act(() => onlineManager.setOnline(false));
      await user.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(sink).toHaveLength(1));
      expect(sink[0]).toEqual({ id: 'members', tone: 'danger', message: OFFLINE_REFRESH_MESSAGE });
      expect(status()).toBe('ready');
      expect(screen.getByTestId('by-user').textContent).toBe('false');
      expect(hits).toBe(1);
      // Back online, TanStack resumes the paused fetch: a background refresh, applied normally.
      members(() => HttpResponse.json(['dropbear', 'pri']));
      act(() => onlineManager.setOnline(true));
      await waitFor(() => expect(screen.getByTestId('names').textContent).toBe('dropbear,pri'));
      await waitFor(() => expect(status()).toBe('ready'));
      expect(hits).toBe(2);
      expect(sink).toHaveLength(1);
    });
  });

  it('an ordinary first failure still offers Try again', async () => {
      members(() => new HttpResponse(null, { status: 500 }));
      renderScreen(<Screen />);
      await screen.findByRole('alert');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

  it('offline with a stale cache: the cache shows, no error face, the paused refresh notifies once', async () => {
    members(() => HttpResponse.json(['dropbear']));
    const first = renderScreen(<Screen />);
    await screen.findByRole('list', { name: 'Members list' });
    first.unmount();
    onlineManager.setOnline(false);
    const sink: ToastRequest[] = [];
    const commits: string[] = [];
    renderScreen(<Screen sink={sink} commits={commits} />);
    expect(commits[0]).not.toBe('loading');
    await waitFor(() => expect(sink).toHaveLength(1));
    expect(sink[0]).toEqual({ id: 'members', tone: 'danger', message: OFFLINE_REFRESH_MESSAGE });
    expect(status()).toBe('ready');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(commits).not.toContain('error');
    expect(hits).toBe(1);
  });

  it('a cached answer whose last refetch failed still shows at open', async () => {
    members(() => HttpResponse.json(['dropbear']));
    const first = renderScreen(<Screen />);
    await screen.findByRole('list', { name: 'Members list' });
    members(() => new HttpResponse(null, { status: 503 }));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['members', 'general'] });
    });
    first.unmount();
    expect(queryClient.getQueryState(['members', 'general'])?.status).toBe('error');
    const commits: string[] = [];
    renderScreen(<Screen commits={commits} />);
    expect(commits[0]).not.toBe('loading');
    expect(screen.getByRole('list', { name: 'Members list' })).toBeInTheDocument();
  });

  it('resetKey NaN is rejected with a clear error', () => {
    function Bad() {
      useLoadState<string[]>({ notifyId: 'm', resetKey: Number.NaN, load: () => Promise.resolve([]), isEmpty: () => true });
      return null;
    }
    const swallow = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', swallow);
    consoleError.mockImplementation(() => {});
    try {
      expect(() => renderWithKit(<Bad />)).toThrow(/resetKey is NaN/);
    } finally {
      window.removeEventListener('error', swallow);
    }
    consoleError.mockReset();
  });

  it('under StrictMode a cached query makes no request and a new one makes exactly one', async () => {
    // Counted for this test's own channel: a request another test left running must not count here.
    let strictHits = 0;
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        if (new URL(request.url).searchParams.get('channel') === 'strict') strictHits += 1;
        return HttpResponse.json(['dropbear']);
      }),
    );
    renderWithKit(
      <StrictMode>
        {wrap(<Screen channel="strict" />)}
      </StrictMode>,
    );
    await screen.findByRole('list', { name: 'Members list' });
    await flush();
    expect(strictHits).toBe(1);
  });
});

describe('LoadState', () => {
  const controller = (over: Partial<LoadController>): LoadController => ({
    status: 'ready',
    error: null,
    retryable: true,
    refreshByUser: false,
    refresh: () => {},
    retry: () => {},
    ...over,
  });

  it('loading: a skeleton and a polite status outside the busy region, the region is busy', () => {
    const { container } = renderWithKit(<View state={controller({ status: 'loading' })} label="API keys" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading API keys');
    expect(status.closest('[aria-busy]')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('list', { name: 'Members list' })).not.toBeInTheDocument();
  });

  it('the status exists before its text: it mounts empty and the text arrives in a later commit', () => {
    const texts: (string | null)[] = [];
    function Probe(): null {
      useLayoutEffect(() => {
        texts.push(document.querySelector('[role="status"]')?.textContent ?? null);
      });
      return null;
    }
    renderWithKit(
      <>
        <View state={controller({ status: 'loading' })} />
        <Probe />
      </>,
    );
    expect(texts[0]).toBe('');
    expect(screen.getByRole('status')).toHaveTextContent('Loading members');
  });

  it('the status stays on the page, empty, on every other face', () => {
    for (const status of ['ready', 'refreshing', 'empty', 'error'] as const) {
      const view = renderWithKit(<View state={controller({ status, error: 'Try again.' })} />);
      expect(screen.getByRole('status')).toHaveTextContent('');
      view.unmount();
    }
  });

  it('ready: the content, not busy', () => {
    const { container } = renderWithKit(<View state={controller({})} />);
    expect(screen.getByRole('list', { name: 'Members list' })).toBeInTheDocument();
    expect(container.querySelector('[aria-busy]')).toBeNull();
  });

  it('refreshing: the content, busy', () => {
    const { container } = renderWithKit(<View state={controller({ status: 'refreshing' })} />);
    expect(screen.getByRole('list', { name: 'Members list' })).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('empty: only the empty node', () => {
    renderWithKit(<View state={controller({ status: 'empty' })} />);
    expect(screen.getByText('No members yet')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Members list' })).not.toBeInTheDocument();
  });

  it('error: a danger alert with the title, the message and Try again calling retry', async () => {
    const retry = vi.fn();
    const { user } = renderWithKit(<View state={controller({ status: 'error', error: 'Offline.', retry })} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load members");
    expect(screen.getByRole('alert')).toHaveTextContent('Offline.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('Try again moves focus to the region, named by its label, when the button goes away', async () => {
    const load = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('500'))
      .mockReturnValueOnce(new Promise(() => {}));
    function Live() {
      const { state } = useLoadState<string[]>({ notifyId: 'members', resetKey: 'a', load, isEmpty: () => false });
      return <View state={state} />;
    }
    const { user } = renderWithKit(<Live />);
    const tryAgain = await screen.findByRole('button', { name: 'Try again' });
    await user.click(tryAgain);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Members' }));
  });
});

describe('LoadState focus after Try again (N2)', () => {
  it('a retry that fails at once leaves no mark: a later load does not take focus from a text field', async () => {
    let setStatus: (status: LoadController['status']) => void = () => {};
    function Harness() {
      const [current, set] = useState<LoadController['status']>('error');
      setStatus = set;
      // Try again fails at once: the status stays error.
      return (
        <>
          <input aria-label="Message" />
          <View
            state={{ status: current, error: 'Try again.', retryable: true, refreshByUser: false, refresh: () => {}, retry: () => set('error') }}
          />
        </>
      );
    }
    const { user } = renderWithKit(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const field = screen.getByRole('textbox', { name: 'Message' });
    await user.click(field);
    act(() => setStatus('loading'));
    expect(field).toHaveFocus();
  });

  it('a retry that did nothing: focus moved by the user is not taken when the face changes later', async () => {
    let setStatus: (status: LoadController['status']) => void = () => {};
    function Harness() {
      const [current, set] = useState<LoadController['status']>('error');
      setStatus = set;
      return (
        <>
          <input aria-label="Message" />
          <View
            state={{ status: current, error: 'Try again.', retryable: true, refreshByUser: false, refresh: () => {}, retry: () => {} }}
          />
        </>
      );
    }
    const { user } = renderWithKit(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const field = screen.getByRole('textbox', { name: 'Message' });
    act(() => field.focus());
    act(() => setStatus('loading'));
    expect(field).toHaveFocus();
  });
});
