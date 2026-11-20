/**
 * useSignOut: the data layer's sign-out is the app's one sequence (useLogout over signOutSession),
 * passed through: no teardown of its own.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const logout = vi.hoisted(() => ({ handleLogout: vi.fn(() => Promise.resolve()), logoutLoading: false }));
vi.mock('../../hooks/useLogout', () => ({ useLogout: () => logout }));

import { useSignOut } from '../../data/session';

describe('useSignOut', () => {
  it("runs the app's sign-out once per call, with no login-page state", async () => {
    const { result } = renderHook(() => useSignOut());
    await result.current.signOut();
    expect(logout.handleLogout).toHaveBeenCalledTimes(1);
    expect(logout.handleLogout).toHaveBeenCalledWith();
  });

});
