import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ServerEvents } from '@semaphore-chat/shared';
import { useDesktopSignInNotice } from '../../hooks/useDesktopSignInNotice';

const showNotification = vi.fn();
let handler: ((payload: unknown) => void) | undefined;
let subscribedTo: string | undefined;

vi.mock('../../contexts/NotificationContext', () => ({
  useNotification: () => ({ showNotification }),
}));

vi.mock('../../socket-hub/useServerEvent', () => ({
  useServerEvent: (event: string, callback: (payload: unknown) => void) => {
    subscribedTo = event;
    handler = callback;
  },
}));

describe('useDesktopSignInNotice', () => {
  it('warns this session when a desktop app signs in', () => {
    renderHook(() => useDesktopSignInNotice());

    expect(subscribedTo).toBe(ServerEvents.DESKTOP_SIGN_IN);
    handler?.({ ipAddress: '203.0.113.9', signedInAt: '2026-11-05T00:00:00.000Z' });

    expect(showNotification).toHaveBeenCalledWith(
      expect.stringMatching(/desktop app just signed in/i),
      'warning',
    );
  });
});
