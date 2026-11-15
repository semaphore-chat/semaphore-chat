import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const granted = vi.hoisted(() => new Set<string>());
vi.mock('../../features/roles/useUserPermissions', () => ({
  useCanPerformAction: vi.fn((type: string, id: string | undefined, action: string) => granted.has(`${type}:${id}:${action}`)),
}));

import { useCommunityActions } from '../../data/communities';
import { useCanPerformAction } from '../../features/roles/useUserPermissions';

describe('useCommunityActions', () => {
  it('offers nothing without the permissions (a plain member)', () => {
    granted.clear();
    expect(renderHook(() => useCommunityActions('c-1')).result.current).toEqual({ canEdit: false, canInvite: false });
  });

  it('reads the same checks the classic screens use, for this community', () => {
    granted.clear();
    granted.add('COMMUNITY:c-1:UPDATE_COMMUNITY');
    expect(renderHook(() => useCommunityActions('c-1')).result.current).toEqual({ canEdit: true, canInvite: false });
    expect(useCanPerformAction).toHaveBeenCalledWith('COMMUNITY', 'c-1', 'UPDATE_COMMUNITY');
    expect(useCanPerformAction).toHaveBeenCalledWith('COMMUNITY', 'c-1', 'CREATE_INVITE');
    // Another community's grant does not leak
    expect(renderHook(() => useCommunityActions('c-2')).result.current.canEdit).toBe(false);
  });
});
