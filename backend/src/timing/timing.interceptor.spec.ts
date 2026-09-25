import { TimingInterceptor } from './timing.interceptor';
import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { of } from 'rxjs';

describe('TimingInterceptor', () => {
  let interceptor: TimingInterceptor;
  let mockExecutionContext: ExecutionContext;
  let mockCallHandler: CallHandler;
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new TimingInterceptor();

    // Spy on the Logger.prototype.log method
    loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    mockExecutionContext = {
      getType: jest.fn().mockReturnValue('http'),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          method: 'GET',
          url: '/api/test',
        }),
      }),
    } as any;

    mockCallHandler = {
      handle: jest.fn().mockReturnValue(of('response')),
    };
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('should intercept and log timing', (done) => {
    const result$ = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );

    result$.subscribe({
      next: (value) => {
        expect(value).toBe('response');
        expect(mockCallHandler.handle).toHaveBeenCalled();
        expect(loggerSpy).toHaveBeenCalled();

        const logCall = loggerSpy.mock.calls[0][0];
        expect(logCall).toContain('HTTP GET /api/test');
        expect(logCall).toMatch(/\d+ms$/);

        done();
      },
    });
  });

  it('should use originalUrl if available', (done) => {
    mockExecutionContext = {
      getType: jest.fn().mockReturnValue('http'),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          method: 'POST',
          originalUrl: '/api/original',
          url: '/api/fallback',
        }),
      }),
    } as any;

    const result$ = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );

    result$.subscribe({
      next: () => {
        const logCall = loggerSpy.mock.calls[0][0];
        expect(logCall).toContain('/api/original');
        expect(logCall).not.toContain('/api/fallback');

        done();
      },
    });
  });

  it('should fall back to url if originalUrl is not available', (done) => {
    mockExecutionContext = {
      getType: jest.fn().mockReturnValue('http'),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          method: 'PUT',
          url: '/api/fallback',
        }),
      }),
    } as any;

    const result$ = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );

    result$.subscribe({
      next: () => {
        const logCall = loggerSpy.mock.calls[0][0];
        expect(logCall).toContain('/api/fallback');

        done();
      },
    });
  });

  it('should log different HTTP methods', async () => {
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

    for (const method of methods) {
      loggerSpy.mockClear();

      mockExecutionContext = {
        getType: jest.fn().mockReturnValue('http'),
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue({
            method,
            url: '/api/test',
          }),
        }),
      } as any;

      await new Promise<void>((resolve) => {
        interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
          next: () => {
            const logCall = loggerSpy.mock.calls[0][0];
            expect(logCall).toContain(method);
            resolve();
          },
        });
      });
    }
  });

  describe('WebSocket handlers', () => {
    class TestGateway {
      handleTyping() {}
    }

    let debugSpy: jest.SpyInstance;

    beforeEach(() => {
      debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
      Reflect.defineMetadata(
        'message',
        'typingStart',
        TestGateway.prototype.handleTyping,
      );
      mockExecutionContext = {
        getType: jest.fn().mockReturnValue('ws'),
        getClass: jest.fn().mockReturnValue(TestGateway),
        getHandler: jest
          .fn()
          .mockReturnValue(TestGateway.prototype.handleTyping),
      } as any;
    });

    afterEach(() => {
      debugSpy.mockRestore();
    });

    it('logs gateway handler timing at debug level, not info', async () => {
      await new Promise<void>((resolve) => {
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .subscribe({ complete: resolve });
      });

      expect(loggerSpy).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy.mock.calls[0][0]).toMatch(
        /^WS TestGateway:typingStart - \d+ms$/,
      );
    });

    it('keeps HTTP timing at info level', async () => {
      mockExecutionContext = {
        getType: jest.fn().mockReturnValue('http'),
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest
            .fn()
            .mockReturnValue({ method: 'GET', url: '/api/test' }),
        }),
      } as any;

      await new Promise<void>((resolve) => {
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .subscribe({ complete: resolve });
      });

      expect(debugSpy).not.toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('should measure elapsed time', (done) => {
    const result$ = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler,
    );

    result$.subscribe({
      next: () => {
        const logCall = loggerSpy.mock.calls[0][0];
        const match = logCall.match(/(\d+)ms$/);
        expect(match).toBeTruthy();

        const duration = parseInt(match[1], 10);
        expect(duration).toBeGreaterThanOrEqual(0);

        done();
      },
    });
  });
});
