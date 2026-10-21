import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getUserInfo } from '../../../features/users/userApiHelpers';
import { queryClient } from '../../../queryClient';
import { userControllerGetUserByIdQueryKey } from '../../../api-client/@tanstack/react-query.gen';

const api = vi.hoisted(() => ({ getUserById: vi.fn() }));
vi.mock('../../../api-client/sdk.gen', () => ({
  userControllerGetUserById: api.getUserById,
}));

const user = {
  id: 'user-1',
  username: 'alice',
  displayName: 'Alice Smith',
  avatarUrl: null,
};

describe('getUserInfo', () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    api.getUserById.mockReset();
  });

  it('returns the locally cached user without asking the API', async () => {
    localStorage.setItem('user_user-1', JSON.stringify(user));

    await expect(getUserInfo('user-1')).resolves.toEqual(user);
    expect(api.getUserById).not.toHaveBeenCalled();
  });

  it('ignores an expired local cache entry', async () => {
    localStorage.setItem(
      'user_user-1',
      JSON.stringify({ value: user, _expiresAt: Date.now() - 1000 }),
    );
    api.getUserById.mockResolvedValue({ data: user });

    await expect(getUserInfo('user-1')).resolves.toEqual(user);
    expect(api.getUserById).toHaveBeenCalled();
    // The stale entry was replaced by a fresh one from the API.
    const stored = JSON.parse(localStorage.getItem('user_user-1') as string);
    expect(stored.value).toEqual(user);
    expect(stored._expiresAt).toBeGreaterThan(Date.now());
  });

  it('uses the TanStack Query cache and copies it into local storage', async () => {
    queryClient.setQueryData(userControllerGetUserByIdQueryKey({ path: { id: 'user-1' } }), user);

    await expect(getUserInfo('user-1')).resolves.toEqual(user);
    expect(api.getUserById).not.toHaveBeenCalled();
    const stored = JSON.parse(localStorage.getItem('user_user-1') as string);
    expect(stored.value).toEqual(user);
    expect(stored._expiresAt).toBeGreaterThan(Date.now());
  });

  it('prefers the local cache over the query cache', async () => {
    const localUser = { ...user, displayName: 'Local Copy' };
    const queryUser = { ...user, displayName: 'Query Copy' };
    localStorage.setItem('user_user-1', JSON.stringify(localUser));
    queryClient.setQueryData(userControllerGetUserByIdQueryKey({ path: { id: 'user-1' } }), queryUser);

    await expect(getUserInfo('user-1')).resolves.toEqual(localUser);
  });

  it('fetches a missing user from the API and caches it', async () => {
    api.getUserById.mockResolvedValue({ data: user });

    await expect(getUserInfo('user-1')).resolves.toEqual(user);

    expect(api.getUserById).toHaveBeenCalledWith({
      path: { id: 'user-1' },
      throwOnError: true,
    });
    const stored = JSON.parse(localStorage.getItem('user_user-1') as string);
    expect(stored.value).toEqual(user);
  });

  it('returns null and caches nothing when the API fails', async () => {
    api.getUserById.mockRejectedValue(new Error('Not Found'));

    await expect(getUserInfo('user-1')).resolves.toBeNull();
    expect(localStorage.getItem('user_user-1')).toBeNull();
  });
});
