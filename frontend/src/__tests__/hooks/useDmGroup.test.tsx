import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createTestQueryClient, createTestWrapper, createDmGroup, createDmGroupMember } from '../test-utils';
import { directMessagesControllerFindUserDmGroupsQueryKey } from '../../api-client/@tanstack/react-query.gen';
import { useDmGroup } from '../../hooks/useDmGroup';
import type { DirectMessageGroup } from '../../types/direct-message.type';

// The group request is controlled per test: it resolves with `fetchedGroup`
// only once `releaseFetch` is called, so the in-flight window is observable.
let fetchedGroup: DirectMessageGroup | undefined;
let releaseFetch: () => void = () => {};
const findDmGroupQueryFn = vi.fn(
  () =>
    new Promise<DirectMessageGroup | undefined>((resolve) => {
      releaseFetch = () => resolve(fetchedGroup);
    }),
);

vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  directMessagesControllerFindDmGroupOptions: ({ path }: { path: { id: string } }) => ({
    queryKey: ['dm-group', path.id],
    queryFn: findDmGroupQueryFn,
  }),
}));

const me = createDmGroupMember({
  userId: 'me',
  user: { id: 'me', username: 'me', displayName: 'Me', avatarUrl: null },
});
const bob = createDmGroupMember({
  userId: 'bob',
  user: { id: 'bob', username: 'bob', displayName: 'Bob Builder', avatarUrl: null },
});

function setup(dmGroupId: string | undefined, listedGroups?: DirectMessageGroup[]) {
  const queryClient = createTestQueryClient();
  if (listedGroups) {
    queryClient.setQueryData(directMessagesControllerFindUserDmGroupsQueryKey(), listedGroups);
  }
  const result = renderHook(() => useDmGroup(dmGroupId), {
    wrapper: createTestWrapper({ queryClient }),
  });
  return { ...result, queryClient };
}

describe('useDmGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchedGroup = undefined;
    releaseFetch = () => {};
  });

  it('serves the cached DM list entry while the group request is in flight', () => {
    const listed = createDmGroup({ id: 'dm-1', isGroup: false, members: [me, bob] });
    const { result } = setup('dm-1', [listed]);

    expect(result.current.data).toEqual(listed);
    expect(result.current.isPlaceholderData).toBe(true);
    expect(findDmGroupQueryFn).toHaveBeenCalledTimes(1);
  });

  it('has no data while loading when the DM list is not cached', () => {
    const { result } = setup('dm-1');

    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
  });

  it('has no data while loading when the cached DM list lacks this group', () => {
    const other = createDmGroup({ id: 'dm-other', isGroup: false, members: [me, bob] });
    const { result } = setup('dm-1', [other]);

    expect(result.current.data).toBeUndefined();
  });

  it('picks up the DM list when it lands after the conversation opened', async () => {
    const { result, queryClient } = setup('dm-1');
    expect(result.current.data).toBeUndefined();

    const listed = createDmGroup({ id: 'dm-1', isGroup: false, members: [me, bob] });
    act(() => {
      queryClient.setQueryData(directMessagesControllerFindUserDmGroupsQueryKey(), [listed]);
    });

    await waitFor(() => expect(result.current.data).toEqual(listed));
    expect(result.current.isPlaceholderData).toBe(true);
  });

  it('never fetches the DM list itself', () => {
    const queryClient = createTestQueryClient();
    renderHook(() => useDmGroup('dm-1'), { wrapper: createTestWrapper({ queryClient }) });

    const listQuery = queryClient.getQueryCache().find({
      queryKey: directMessagesControllerFindUserDmGroupsQueryKey(),
    });
    expect(listQuery?.state.fetchStatus).toBe('idle');
    expect(listQuery?.state.dataUpdateCount).toBe(0);
  });

  it('replaces the cached list entry with the fetched group once it loads', async () => {
    const listed = createDmGroup({ id: 'dm-1', name: 'Old name', members: [me, bob] });
    fetchedGroup = createDmGroup({ id: 'dm-1', name: 'Fresh name', members: [me, bob] });
    const { result } = setup('dm-1', [listed]);
    expect(result.current.data?.name).toBe('Old name');

    releaseFetch();

    await waitFor(() => expect(result.current.data?.name).toBe('Fresh name'));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it('does not fetch without a DM group id', () => {
    const { result } = setup(undefined, [createDmGroup({ id: 'dm-1' })]);

    expect(result.current.data).toBeUndefined();
    expect(findDmGroupQueryFn).not.toHaveBeenCalled();
  });
});
