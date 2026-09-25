import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import { HttpThrottlerGuard } from './http-throttler.guard';

describe('HttpThrottlerGuard', () => {
  let guard: HttpThrottlerGuard;
  let storage: jest.Mocked<ThrottlerStorage>;

  const contextOf = (type: 'http' | 'ws'): ExecutionContext =>
    ({
      getType: () => type,
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({
        getRequest: () => ({ ip: '203.0.113.7', headers: {} }),
        getResponse: () => ({ header: jest.fn() }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    storage = {
      increment: jest.fn().mockResolvedValue({
        totalHits: 1,
        timeToExpire: 1,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    };
    guard = new HttpThrottlerGuard(
      { throttlers: [{ name: 'short', ttl: 1000, limit: 20 }] },
      storage,
      new Reflector(),
    );
    await guard.onModuleInit();
  });

  it('is a ThrottlerGuard', () => {
    expect(guard).toBeInstanceOf(ThrottlerGuard);
  });

  it('throttles HTTP requests', async () => {
    await expect(guard.canActivate(contextOf('http'))).resolves.toBe(true);
    expect(storage.increment).toHaveBeenCalledTimes(1);
  });

  it('skips WebSocket handlers (Nest 12 runs global guards there too)', async () => {
    await expect(guard.canActivate(contextOf('ws'))).resolves.toBe(true);
    expect(storage.increment).not.toHaveBeenCalled();
  });
});
