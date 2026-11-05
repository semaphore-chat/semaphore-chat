/**
 * Exports the web client's cache rules as language-neutral data for `semaphore-core` (unit U5).
 *
 * Run with `native/scripts/gen-cache-vectors.sh`, which copies the output to `native/fixtures/cache`.
 *
 * - `message-cache-updaters.json`: this file wraps every function in `messageCacheUpdaters.ts` and
 *   runs the web client's own test file through the wrappers. Each call those tests make becomes a
 *   vector with its input and its whole output, so a Rust test checks more than the original
 *   assertions did, and nothing here restates the logic.
 * - `socket-rules.json`: every server event through the real `handlerRegistry`, and a reconnect
 *   through `handleReconnect`, against a spied QueryClient, recording which queries each touches.
 */
import { afterAll, beforeEach, describe, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';

const NOW = new Date('2026-09-22T18:00:00.000Z');
vi.useFakeTimers({ toFake: ['Date'], now: NOW });

type Call = { test: string; op: string; args: unknown[]; result: unknown; sameRef: boolean };
const calls: Call[] = vi.hoisted(() => []);

/** `undefined` has no JSON form. Both it and a missing value read as null on the Rust side. */
const plain = (value: unknown) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

vi.mock('../../utils/messageCacheUpdaters', async (importOriginal) => {
  const { expect } = await import('vitest');
  const actual = await importOriginal<Record<string, unknown>>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const [op, fn] of Object.entries(actual)) {
    if (typeof fn !== 'function') continue;
    wrapped[op] = (...args: unknown[]) => {
      const before = args.map(plain);
      const result = (fn as (...a: unknown[]) => unknown)(...args);
      calls.push({
        test: expect.getState().currentTestName ?? '',
        op,
        args: before,
        result: plain(result),
        sameRef: args[0] !== undefined && result === args[0],
      });
      return result;
    };
  }
  return wrapped;
});

// Registers the web client's own tests in this file, calling the wrappers above.
await import('../utils/messageCacheUpdaters.test');

const { QueryClient } = await import('@tanstack/react-query');
const { ServerEvents } = await import('@semaphore-chat/shared');
const { handlerRegistry } = await import('../../socket-hub/handlers');
const { handleReconnect } = await import('../../socket-hub/handlers/reconnectHandlers');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

type Touched = Record<'invalidate' | 'set' | 'remove' | 'reset', Set<string>>;

/** `[{ _id, path }]` to `op` or `op:pathValue`, so a scoped invalidation stays visibly scoped. */
function keyName(queryKey: unknown): string {
  const first = (queryKey as unknown[])[0];
  if (typeof first !== 'object' || first === null) return String(first);
  const { _id, path } = first as { _id: string; path?: Record<string, string> };
  return path && Object.keys(path).length ? `${_id}:${Object.keys(path).sort().join(',')}` : _id;
}

function spiedClient(data: (key: string) => unknown) {
  const client = new QueryClient();
  const touched: Touched = { invalidate: new Set(), set: new Set(), remove: new Set(), reset: new Set() };
  vi.spyOn(client, 'getQueryData').mockImplementation(((key: unknown) => data(keyName(key))) as never);
  vi.spyOn(client, 'cancelQueries').mockResolvedValue(undefined);
  vi.spyOn(client, 'invalidateQueries').mockImplementation((async (filters: { queryKey: unknown }) => {
    touched.invalidate.add(keyName(filters.queryKey));
  }) as never);
  vi.spyOn(client, 'resetQueries').mockImplementation((async (filters: { queryKey: unknown }) => {
    touched.reset.add(keyName(filters.queryKey));
  }) as never);
  vi.spyOn(client, 'removeQueries').mockImplementation(((filters: { queryKey: unknown }) => {
    touched.remove.add(keyName(filters.queryKey));
  }) as never);
  vi.spyOn(client, 'setQueryData').mockImplementation(((key: unknown) => {
    touched.set.add(keyName(key));
  }) as never);
  vi.spyOn(client, 'setQueriesData').mockImplementation(((filters: { queryKey: unknown }) => {
    touched.set.add(keyName(filters.queryKey));
    return [];
  }) as never);
  return { client, touched };
}

const message = (overrides: object) => ({
  id: 'msg', authorId: 'someone', spans: [], reactions: [], attachments: [], ...overrides,
});
const common = {
  communityId: 'comm', userId: 'someone', messageId: 'msg', dmGroupId: 'dm', parentMessageId: 'parent',
  replyCount: 1, lastReplyAt: null, lastReadMessageId: 'msg', lastReadAt: NOW.toISOString(),
  emoji: 'x', reaction: { emoji: 'x', userIds: [] }, reactions: [], pinnedBy: 'someone', pinnedAt: null,
  user: { id: 'someone', username: 'someone', joinedAt: NOW.toISOString() },
  reply: message({ id: 'reply' }), notificationId: 'n', type: 'USER_MENTION', read: false,
  createdAt: NOW.toISOString(), authorId: 'someone',
};
const payloads = [
  { ...common, channelId: 'chan', directMessageGroupId: null, message: message({ channelId: 'chan', directMessageGroupId: null }) },
  { ...common, channelId: null, directMessageGroupId: 'dm', message: message({ channelId: null, directMessageGroupId: 'dm' }) },
];
const profile = (id: string) => ({ id });
const caches: Array<(key: string) => unknown> = [
  () => undefined,
  (key) =>
    key === 'userControllerGetProfile'
      ? profile('me')
      : { users: [], notifications: [], pages: [{ messages: [] }], pageParams: [''] },
  // The sender's own message, in a window detached from the live edge.
  (key) =>
    key === 'userControllerGetProfile'
      ? profile('someone')
      : { users: [], notifications: [], pages: [{ messages: [] }], pageParams: ['cursor'] },
];

const sorted = (set: Set<string>) => [...set].sort();
const rules: Record<string, Record<string, string[]>> = {};
let reconnect: Record<string, unknown> = {};

describe('socket rules', () => {
  for (const name of Object.values(ServerEvents) as string[]) {
    it(`exports ${name}`, async () => {
      const handlers = (handlerRegistry as Record<string, unknown[] | undefined>)[name];
      const union: Touched = { invalidate: new Set(), set: new Set(), remove: new Set(), reset: new Set() };
      for (const data of caches) {
        for (const payload of payloads) {
          const { client, touched } = spiedClient(data);
          for (const handler of handlers ?? []) {
            await (handler as (p: unknown, c: unknown) => unknown)(payload, client);
          }
          for (const kind of ['invalidate', 'set', 'remove', 'reset'] as const) {
            touched[kind].forEach((key) => union[kind].add(key));
          }
        }
      }
      rules[name] = {
        invalidate: sorted(union.invalidate),
        set: sorted(union.set),
        remove: sorted(union.remove),
        reset: sorted(union.reset),
      };
    });
  }

  it('exports the reconnect table', () => {
    const client = new QueryClient();
    const live = ['messagesControllerFindAllForChannel', 'live'];
    const detached = ['messagesControllerFindAllForChannel', 'detached'];
    client.setQueryData([{ _id: live[0], path: { channelId: live[1] } }], { pages: [], pageParams: [''] });
    client.setQueryData([{ _id: detached[0], path: { channelId: detached[1] } }], { pages: [], pageParams: ['cursor'] });
    const invalidated: unknown[] = [];
    const reset: unknown[] = [];
    vi.spyOn(client, 'invalidateQueries').mockImplementation((async (filters: { queryKey: unknown }) => {
      invalidated.push(filters.queryKey);
    }) as never);
    vi.spyOn(client, 'resetQueries').mockImplementation((async (filters: { queryKey: unknown }) => {
      reset.push(filters.queryKey);
    }) as never);
    handleReconnect(client);
    const channelId = (key: unknown) =>
      ((key as Array<{ path?: { channelId?: string } }>)[0].path ?? {}).channelId;
    reconnect = {
      invalidate: sorted(new Set(invalidated.filter((key) => !channelId(key)).map(keyName))),
      invalidatedWindows: invalidated.map(channelId).filter(Boolean),
      resetWindows: reset.map(channelId).filter(Boolean),
    };
  });
});

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as object)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
};

afterAll(() => {
  mkdirSync('native-export-out/cache-vectors', { recursive: true });
  const write = (name: string, value: unknown) =>
    writeFileSync(`native-export-out/cache-vectors/${name}.json`, `${JSON.stringify(stable(value), null, 2)}\n`);
  // The handlers below call `isDetachedFromLiveEdge` too. Only the web client's own tests are vectors.
  const vectors = calls.filter((call) => !call.test.startsWith('socket rules'));
  write('message-cache-updaters', { source: 'frontend/src/__tests__/utils/messageCacheUpdaters.test.ts', calls: vectors });
  write('socket-rules', { events: rules, reconnect });
});
