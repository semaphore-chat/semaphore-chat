import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type {
  ChannelVoicePresenceResponseDto,
  DmVoicePresenceResponseDto,
  VoicePresenceUserDto,
} from '../../../api-client/types.gen';
import {
  voicePresenceControllerGetChannelPresenceQueryKey,
  dmVoicePresenceControllerGetDmPresenceQueryKey,
} from '../../../api-client/@tanstack/react-query.gen';
import {
  handleVoiceUserJoined,
  handleVoiceUserLeft,
  handleVoiceUserUpdated,
  handleDmVoiceCallStarted,
  handleDmVoiceUserJoined,
  handleDmVoiceUserLeft,
} from '../../../socket-hub/handlers/voiceHandlers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The websocket presence payloads carry live media state (mute/camera/screen)
 * on top of the REST VoicePresenceUserDto, and the handlers store them in the
 * cache as-is — model that with an extended test type.
 */
type TestVoiceUser = VoicePresenceUserDto & {
  isMuted: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
};

type TestChannelPresence = Omit<ChannelVoicePresenceResponseDto, 'users'> & { users: TestVoiceUser[] };
type TestDmPresence = Omit<DmVoicePresenceResponseDto, 'users'> & { users: TestVoiceUser[] };

function makeVoiceUser(overrides: Partial<TestVoiceUser> = {}): TestVoiceUser {
  return {
    id: 'user-1',
    username: 'alice',
    avatarUrl: null,
    isMuted: false,
    isDeafened: false,
    isCameraOn: false,
    isScreenSharing: false,
    ...overrides,
  } as TestVoiceUser;
}

function makeChannelPresence(
  users: TestVoiceUser[],
): TestChannelPresence {
  return { users, count: users.length } as TestChannelPresence;
}

function makeDmPresence(
  users: TestVoiceUser[],
): TestDmPresence {
  return { users, count: users.length } as TestDmPresence;
}

// ---------------------------------------------------------------------------
// Channel Voice Handlers
// ---------------------------------------------------------------------------

describe('voiceHandlers — channel', () => {
  let queryClient: QueryClient;
  const channelId = 'ch-1';

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  describe('handleVoiceUserJoined', () => {
    it('adds a user to the channel presence cache and updates count', () => {
      const queryKey = voicePresenceControllerGetChannelPresenceQueryKey({ path: { channelId } });
      queryClient.setQueryData(queryKey, makeChannelPresence([]));

      const user = makeVoiceUser({ id: 'user-1' });
      handleVoiceUserJoined({ channelId, user } as never, queryClient);

      const data = queryClient.getQueryData<TestChannelPresence>(queryKey);
      expect(data!.users).toHaveLength(1);
      expect(data!.users[0].id).toBe('user-1');
      expect(data!.count).toBe(1);
    });

    it('does not add a duplicate when the user is already present (idempotency)', () => {
      const existing = makeVoiceUser({ id: 'user-1' });
      const queryKey = voicePresenceControllerGetChannelPresenceQueryKey({ path: { channelId } });
      queryClient.setQueryData(queryKey, makeChannelPresence([existing]));

      handleVoiceUserJoined({ channelId, user: existing } as never, queryClient);

      const data = queryClient.getQueryData<TestChannelPresence>(queryKey);
      expect(data!.users).toHaveLength(1);
      expect(data!.count).toBe(1);
    });

    it('falls back to invalidation when there is no existing cache', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      const user = makeVoiceUser({ id: 'user-1' });
      handleVoiceUserJoined({ channelId, user } as never, queryClient);

      expect(spy).toHaveBeenCalled();
    });

    it('adds multiple different users correctly', () => {
      const queryKey = voicePresenceControllerGetChannelPresenceQueryKey({ path: { channelId } });
      queryClient.setQueryData(queryKey, makeChannelPresence([makeVoiceUser({ id: 'user-1' })]));

      handleVoiceUserJoined({ channelId, user: makeVoiceUser({ id: 'user-2', username: 'bob' }) } as never, queryClient);

      const data = queryClient.getQueryData<TestChannelPresence>(queryKey);
      expect(data!.users).toHaveLength(2);
      expect(data!.count).toBe(2);
    });
  });

  describe('handleVoiceUserLeft', () => {
    it('removes a user from the channel presence cache and updates count', () => {
      const user = makeVoiceUser({ id: 'user-1' });
      const queryKey = voicePresenceControllerGetChannelPresenceQueryKey({ path: { channelId } });
      queryClient.setQueryData(queryKey, makeChannelPresence([user]));

      handleVoiceUserLeft({ channelId, userId: 'user-1' } as never, queryClient);

      const data = queryClient.getQueryData<TestChannelPresence>(queryKey);
      expect(data!.users).toHaveLength(0);
      expect(data!.count).toBe(0);
    });

    it('is a no-op when the user is not in the cache', () => {
      const other = makeVoiceUser({ id: 'user-2' });
      const queryKey = voicePresenceControllerGetChannelPresenceQueryKey({ path: { channelId } });
      queryClient.setQueryData(queryKey, makeChannelPresence([other]));

      handleVoiceUserLeft({ channelId, userId: 'user-999' } as never, queryClient);

      const data = queryClient.getQueryData<TestChannelPresence>(queryKey);
      expect(data!.users).toHaveLength(1);
      expect(data!.count).toBe(1);
    });

    it('falls back to invalidation when there is no existing cache', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleVoiceUserLeft({ channelId, userId: 'user-1' } as never, queryClient);

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('handleVoiceUserUpdated', () => {
    it('updates a user in the channel presence cache', () => {
      const user = makeVoiceUser({ id: 'user-1', isMuted: false });
      const queryKey = voicePresenceControllerGetChannelPresenceQueryKey({ path: { channelId } });
      queryClient.setQueryData(queryKey, makeChannelPresence([user]));

      const updatedUser = makeVoiceUser({ id: 'user-1', isMuted: true });
      handleVoiceUserUpdated({ channelId, user: updatedUser } as never, queryClient);

      const data = queryClient.getQueryData<TestChannelPresence>(queryKey);
      expect(data!.users[0].isMuted).toBe(true);
    });

    it('does not add the user if they are not already in the cache', () => {
      const existing = makeVoiceUser({ id: 'user-1' });
      const queryKey = voicePresenceControllerGetChannelPresenceQueryKey({ path: { channelId } });
      queryClient.setQueryData(queryKey, makeChannelPresence([existing]));

      const unknownUser = makeVoiceUser({ id: 'user-999', isMuted: true });
      handleVoiceUserUpdated({ channelId, user: unknownUser } as never, queryClient);

      const data = queryClient.getQueryData<TestChannelPresence>(queryKey);
      expect(data!.users).toHaveLength(1);
      expect(data!.users[0].id).toBe('user-1');
    });

    it('falls back to invalidation when there is no existing cache', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleVoiceUserUpdated({ channelId, user: makeVoiceUser() } as never, queryClient);

      expect(spy).toHaveBeenCalled();
    });

    it('preserves other users when updating one user', () => {
      const user1 = makeVoiceUser({ id: 'user-1', isMuted: false });
      const user2 = makeVoiceUser({ id: 'user-2', isMuted: false, username: 'bob' });
      const queryKey = voicePresenceControllerGetChannelPresenceQueryKey({ path: { channelId } });
      queryClient.setQueryData(queryKey, makeChannelPresence([user1, user2]));

      handleVoiceUserUpdated({ channelId, user: makeVoiceUser({ id: 'user-1', isMuted: true }) } as never, queryClient);

      const data = queryClient.getQueryData<TestChannelPresence>(queryKey);
      expect(data!.users).toHaveLength(2);
      expect(data!.users[0].isMuted).toBe(true);
      expect(data!.users[1].id).toBe('user-2');
      expect(data!.users[1].isMuted).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// DM Voice Handlers
// ---------------------------------------------------------------------------

describe('voiceHandlers — DM', () => {
  let queryClient: QueryClient;
  const dmGroupId = 'dm-1';

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  describe('handleDmVoiceCallStarted', () => {
    it('triggers full query invalidation', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleDmVoiceCallStarted({} as never, queryClient);

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('handleDmVoiceUserJoined', () => {
    it('adds a user to the DM presence cache and updates count', () => {
      const queryKey = dmVoicePresenceControllerGetDmPresenceQueryKey({ path: { dmGroupId } });
      queryClient.setQueryData(queryKey, makeDmPresence([]));

      const user = makeVoiceUser({ id: 'user-1' });
      handleDmVoiceUserJoined({ dmGroupId, user } as never, queryClient);

      const data = queryClient.getQueryData<TestDmPresence>(queryKey);
      expect(data!.users).toHaveLength(1);
      expect(data!.count).toBe(1);
    });

    it('does not duplicate an already-present user', () => {
      const user = makeVoiceUser({ id: 'user-1' });
      const queryKey = dmVoicePresenceControllerGetDmPresenceQueryKey({ path: { dmGroupId } });
      queryClient.setQueryData(queryKey, makeDmPresence([user]));

      handleDmVoiceUserJoined({ dmGroupId, user } as never, queryClient);

      const data = queryClient.getQueryData<TestDmPresence>(queryKey);
      expect(data!.users).toHaveLength(1);
    });

    it('falls back to invalidation when there is no existing cache', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleDmVoiceUserJoined({ dmGroupId, user: makeVoiceUser() } as never, queryClient);

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('handleDmVoiceUserLeft', () => {
    it('removes a user from the DM presence cache and updates count', () => {
      const user = makeVoiceUser({ id: 'user-1' });
      const queryKey = dmVoicePresenceControllerGetDmPresenceQueryKey({ path: { dmGroupId } });
      queryClient.setQueryData(queryKey, makeDmPresence([user]));

      handleDmVoiceUserLeft({ dmGroupId, userId: 'user-1' } as never, queryClient);

      const data = queryClient.getQueryData<TestDmPresence>(queryKey);
      expect(data!.users).toHaveLength(0);
      expect(data!.count).toBe(0);
    });

    it('falls back to invalidation when there is no existing cache', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleDmVoiceUserLeft({ dmGroupId, userId: 'user-1' } as never, queryClient);

      expect(spy).toHaveBeenCalled();
    });
  });

});
