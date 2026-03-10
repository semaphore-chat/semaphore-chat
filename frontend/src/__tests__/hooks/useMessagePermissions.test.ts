import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createMessage } from '../test-utils';

const mockCanPerformAction = vi.fn();
vi.mock('../../features/roles/useUserPermissions', () => ({
  useCanPerformAction: (...args: unknown[]) => mockCanPerformAction(...args),
}));

import { useMessagePermissions } from '../../hooks/useMessagePermissions';

describe('useMessagePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanPerformAction.mockReturnValue(false);
  });

  it('returns canEdit=true, canDelete=true, isOwnMessage=true for own message', () => {
    const message = createMessage({ authorId: 'user-1' });
    const { result } = renderHook(() =>
      useMessagePermissions({ message, currentUserId: 'user-1' }),
    );

    expect(result.current.isOwnMessage).toBe(true);
    expect(result.current.canEdit).toBe(true);
    expect(result.current.canDelete).toBe(true);
  });

  it('returns canEdit=false, canDelete=false for others message without permission', () => {
    const message = createMessage({ authorId: 'other-user' });
    const { result } = renderHook(() =>
      useMessagePermissions({ message, currentUserId: 'user-1' }),
    );

    expect(result.current.isOwnMessage).toBe(false);
    expect(result.current.canEdit).toBe(false);
    expect(result.current.canDelete).toBe(false);
  });

  it('returns canDelete=true for others message with DELETE_MESSAGE permission', () => {
    mockCanPerformAction.mockImplementation(
      (_type: string, _id: string, action: string) => {
        return action === 'DELETE_MESSAGE';
      },
    );
    const message = createMessage({ authorId: 'other-user' });
    const { result } = renderHook(() =>
      useMessagePermissions({ message, currentUserId: 'user-1' }),
    );

    expect(result.current.canEdit).toBe(false);
    expect(result.current.canDelete).toBe(true);
  });

  it('returns all false when currentUserId is undefined', () => {
    const message = createMessage({ authorId: 'user-1' });
    const { result } = renderHook(() =>
      useMessagePermissions({ message, currentUserId: undefined }),
    );

    expect(result.current.isOwnMessage).toBe(false);
    expect(result.current.canEdit).toBe(false);
    expect(result.current.canDelete).toBe(false);
  });

  it('returns canPin=true when user has PIN_MESSAGE permission', () => {
    mockCanPerformAction.mockImplementation(
      (_type: string, _id: string, action: string) => {
        return action === 'PIN_MESSAGE';
      },
    );
    const message = createMessage({ authorId: 'other-user' });
    const { result } = renderHook(() =>
      useMessagePermissions({ message, currentUserId: 'user-1' }),
    );

    expect(result.current.canPin).toBe(true);
  });

  it('correctly identifies own vs others message via isOwnMessage', () => {
    const message = createMessage({ authorId: 'user-1' });

    const { result: ownResult } = renderHook(() =>
      useMessagePermissions({ message, currentUserId: 'user-1' }),
    );
    expect(ownResult.current.isOwnMessage).toBe(true);

    const { result: otherResult } = renderHook(() =>
      useMessagePermissions({ message, currentUserId: 'user-2' }),
    );
    expect(otherResult.current.isOwnMessage).toBe(false);
  });

  describe('DM context (directMessageGroupId set, no channelId)', () => {
    it('returns canPin=false for DMs (backend forbids pinning in DMs)', () => {
      const message = createMessage({
        authorId: 'other-user',
        channelId: undefined,
        directMessageGroupId: 'dm-group-1',
      });
      const { result } = renderHook(() =>
        useMessagePermissions({ message, currentUserId: 'user-1' }),
      );

      expect(result.current.canPin).toBe(false);
    });

    it('returns canReact=true for any DM participant', () => {
      const message = createMessage({
        authorId: 'other-user',
        channelId: undefined,
        directMessageGroupId: 'dm-group-1',
      });
      const { result } = renderHook(() =>
        useMessagePermissions({ message, currentUserId: 'user-1' }),
      );

      expect(result.current.canReact).toBe(true);
    });

    it('returns canDelete=false for others messages in DMs', () => {
      const message = createMessage({
        authorId: 'other-user',
        channelId: undefined,
        directMessageGroupId: 'dm-group-1',
      });
      const { result } = renderHook(() =>
        useMessagePermissions({ message, currentUserId: 'user-1' }),
      );

      expect(result.current.canDelete).toBe(false);
    });

    it('returns canEdit=true and canDelete=true for own DM messages', () => {
      const message = createMessage({
        authorId: 'user-1',
        channelId: undefined,
        directMessageGroupId: 'dm-group-1',
      });
      const { result } = renderHook(() =>
        useMessagePermissions({ message, currentUserId: 'user-1' }),
      );

      expect(result.current.canEdit).toBe(true);
      expect(result.current.canDelete).toBe(true);
      expect(result.current.canReact).toBe(true);
    });

    it('does not pass DM resourceId to RBAC checks', () => {
      const message = createMessage({
        authorId: 'other-user',
        channelId: undefined,
        directMessageGroupId: 'dm-group-1',
      });
      renderHook(() =>
        useMessagePermissions({ message, currentUserId: 'user-1' }),
      );

      // Should call with undefined resourceId, not the DM group ID
      expect(mockCanPerformAction).toHaveBeenCalledWith(
        'CHANNEL',
        undefined,
        'DELETE_MESSAGE',
      );
      expect(mockCanPerformAction).toHaveBeenCalledWith(
        'CHANNEL',
        undefined,
        'PIN_MESSAGE',
      );
    });
  });
});
