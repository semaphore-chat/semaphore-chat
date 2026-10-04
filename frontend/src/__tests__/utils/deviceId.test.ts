import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockApiBase = vi.fn(() => '/api');
vi.mock('../../config/env', () => ({
  getApiBaseUrl: () => mockApiBase(),
}));

import { DEVICE_ID_HEADER, deviceIdHeaders, getDeviceId } from '../../utils/deviceId';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('getDeviceId (#563)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockApiBase.mockReturnValue('/api');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a UUID once and keeps it in localStorage', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID');

    const first = getDeviceId();
    const second = getDeviceId();

    expect(first).toMatch(UUID_V4);
    expect(second).toBe(first);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('semaphore:deviceId:/api')).toBe(first);
  });

  it('reuses the stored id, as after a reload', () => {
    localStorage.setItem('semaphore:deviceId:/api', 'stored-id');

    expect(getDeviceId()).toBe('stored-id');
  });

  it('keeps one id per server (desktop app with several servers)', () => {
    mockApiBase.mockReturnValue('https://a.example/api');
    const a = getDeviceId();
    mockApiBase.mockReturnValue('https://b.example/api');
    const b = getDeviceId();

    expect(a).not.toBe(b);
    mockApiBase.mockReturnValue('https://a.example/api');
    expect(getDeviceId()).toBe(a);
  });

  it('works without crypto.randomUUID (plain HTTP)', () => {
    const own = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      expect(getDeviceId()).toMatch(UUID_V4);
    } finally {
      if (own) Object.defineProperty(crypto, 'randomUUID', own);
      else delete (crypto as { randomUUID?: unknown }).randomUUID;
    }
  });

  it('falls back to an id for the page when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    const first = getDeviceId();

    expect(first).toMatch(UUID_V4);
    expect(getDeviceId()).toBe(first);
  });

  it('builds the header the backend reads', () => {
    expect(deviceIdHeaders()).toEqual({ [DEVICE_ID_HEADER]: getDeviceId() });
    expect(DEVICE_ID_HEADER).toBe('X-Device-Id');
  });
});
