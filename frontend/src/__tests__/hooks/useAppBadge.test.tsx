import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppBadge } from '../../hooks/useAppBadge';
import { notificationsControllerGetUnreadCountQueryKey } from '../../api-client/@tanstack/react-query.gen';

const mockSetAppBadge = vi.fn().mockResolvedValue(undefined);
const mockClearAppBadge = vi.fn().mockResolvedValue(undefined);

function renderWithUnreadCount(count: number | null, baseTitle = 'Semaphore Chat') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (count !== null) {
    queryClient.setQueryData(notificationsControllerGetUnreadCountQueryKey(), { count });
  }
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(() => useAppBadge(baseTitle), { wrapper }) };
}

describe('useAppBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'setAppBadge', {
      value: mockSetAppBadge,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'clearAppBadge', {
      value: mockClearAppBadge,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    delete (navigator as { setAppBadge?: unknown }).setAppBadge;
    delete (navigator as { clearAppBadge?: unknown }).clearAppBadge;
    document.title = '';
  });

  it('sets the app badge and title prefix when there are unread notifications', () => {
    renderWithUnreadCount(5);

    expect(mockSetAppBadge).toHaveBeenCalledWith(5);
    expect(document.title).toBe('(5) Semaphore Chat');
  });

  it("takes the count off the badge and the title on unmount (sign-out), so the login page doesn't show it", () => {
    const { unmount } = renderWithUnreadCount(3);
    expect(document.title).toBe('(3) Semaphore Chat');
    mockClearAppBadge.mockClear();

    unmount();

    expect(document.title).toBe('Semaphore Chat');
    expect(mockClearAppBadge).toHaveBeenCalled();
  });

  it('clears the badge and prefix when unread count is zero', () => {
    renderWithUnreadCount(0);

    expect(mockClearAppBadge).toHaveBeenCalled();
    expect(mockSetAppBadge).not.toHaveBeenCalled();
    expect(document.title).toBe('Semaphore Chat');
  });

  it('updates badge and title when the cached count changes', async () => {
    const { queryClient } = renderWithUnreadCount(1);
    expect(document.title).toBe('(1) Semaphore Chat');

    queryClient.setQueryData(notificationsControllerGetUnreadCountQueryKey(), { count: 7 });

    await waitFor(() => {
      expect(document.title).toBe('(7) Semaphore Chat');
    });
    expect(mockSetAppBadge).toHaveBeenLastCalledWith(7);
  });

  it('still manages the title when the Badging API is unavailable', () => {
    delete (navigator as { setAppBadge?: unknown }).setAppBadge;
    delete (navigator as { clearAppBadge?: unknown }).clearAppBadge;

    expect(() => renderWithUnreadCount(3)).not.toThrow();
    expect(document.title).toBe('(3) Semaphore Chat');
  });

  it('uses the plain base title before any count is cached', () => {
    renderWithUnreadCount(null, 'My Instance');
    expect(document.title).toBe('My Instance');
  });
});
