import { ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { WsThrottleGuard } from './ws-throttle.guard';

describe('WsThrottleGuard', () => {
  let guard: WsThrottleGuard;
  const originalEnv = process.env.NODE_ENV;

  function createMockContext(socketId: string): ExecutionContext {
    return {
      switchToWs: () => ({
        getClient: () => ({ id: socketId }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    // Ensure NODE_ENV is not 'test' so the guard actually runs
    process.env.NODE_ENV = 'development';
    guard = new WsThrottleGuard();
  });

  afterEach(() => {
    guard.onModuleDestroy();
    process.env.NODE_ENV = originalEnv;
  });

  it('allows requests within the rate limit', () => {
    const ctx = createMockContext('socket-1');

    for (let i = 0; i < 50; i++) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('throws WsException when rate limit is exceeded', () => {
    const ctx = createMockContext('socket-1');

    // Use up all 50 allowed events
    for (let i = 0; i < 50; i++) {
      guard.canActivate(ctx);
    }

    // 51st event should throw
    expect(() => guard.canActivate(ctx)).toThrow(WsException);
    expect(() => guard.canActivate(ctx)).toThrow('Rate limit exceeded');
  });

  it('tracks limits per socket independently', () => {
    const ctx1 = createMockContext('socket-1');
    const ctx2 = createMockContext('socket-2');

    // Max out socket-1
    for (let i = 0; i < 50; i++) {
      guard.canActivate(ctx1);
    }

    // socket-2 should still work
    expect(guard.canActivate(ctx2)).toBe(true);
  });

  it('resets the window after the time period', () => {
    const ctx = createMockContext('socket-1');

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    // Max out the limit
    for (let i = 0; i < 50; i++) {
      guard.canActivate(ctx);
    }
    expect(() => guard.canActivate(ctx)).toThrow(WsException);

    // Advance time past the 10s window
    jest.spyOn(Date, 'now').mockReturnValue(now + 10001);

    // Should work again
    expect(guard.canActivate(ctx)).toBe(true);

    jest.restoreAllMocks();
  });

  it('bypasses rate limiting in test environment', () => {
    process.env.NODE_ENV = 'test';
    const ctx = createMockContext('socket-1');

    // Should not throw even after many events
    for (let i = 0; i < 100; i++) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });
});
