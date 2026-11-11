import {
  ArgumentsHost,
  ForbiddenException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ErrorCode } from '@semaphore-chat/shared';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  const adapter = {
    reply: jest.fn(),
    end: jest.fn(),
    isHeadersSent: jest.fn(),
  };
  const response = {};
  const host = {
    getType: () => 'http',
    getArgByIndex: () => response,
  } as unknown as ArgumentsHost;
  let filter: ApiExceptionFilter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter.isHeadersSent.mockReturnValue(false);
    jest.spyOn(Logger, 'error').mockImplementation();
    filter = new ApiExceptionFilter();
    Object.assign(filter, { httpAdapterHost: { httpAdapter: adapter } });
  });

  const repliedBody = () => adapter.reply.mock.calls[0][1] as unknown;
  const repliedStatus = () => adapter.reply.mock.calls[0][2] as unknown;

  it('keeps the body and adds a code from the status', () => {
    filter.catch(new NotFoundException('Gone'), host);

    expect(repliedBody()).toEqual({
      statusCode: 404,
      message: 'Gone',
      error: 'Not Found',
      errorCode: ErrorCode.NOT_FOUND,
      retryable: false,
    });
    expect(repliedStatus()).toBe(404);
  });

  it('a code set where the error was thrown wins', () => {
    filter.catch(
      new ForbiddenException('No', {
        description: 'Forbidden',
        errorCode: ErrorCode.FILE_NOT_OWNED,
      }),
      host,
    );

    expect(repliedBody()).toEqual({
      statusCode: 403,
      message: 'No',
      error: 'Forbidden',
      errorCode: ErrorCode.FILE_NOT_OWNED,
      retryable: false,
    });
  });

  it('keeps a custom body and retryAfterMs', () => {
    filter.catch(
      new ForbiddenException({
        message: 'Wait',
        errorCode: ErrorCode.SLOWMODE,
        retryAfterMs: 5000,
      }),
      host,
    );

    expect(repliedBody()).toEqual({
      message: 'Wait',
      errorCode: ErrorCode.SLOWMODE,
      retryable: true,
      retryAfterMs: 5000,
    });
  });

  it('does not mark a moderation timeout retryable, but says how long', () => {
    filter.catch(
      new ForbiddenException({
        message: 'Timed out',
        errorCode: ErrorCode.TIMED_OUT,
        retryAfterMs: 5000,
      }),
      host,
    );

    expect(repliedBody()).toEqual({
      message: 'Timed out',
      errorCode: ErrorCode.TIMED_OUT,
      retryable: false,
      retryAfterMs: 5000,
    });
  });

  it('handles a string response like Nest does', () => {
    filter.catch(new HttpException('Teapot', 418), host);

    expect(repliedBody()).toEqual({
      statusCode: 418,
      message: 'Teapot',
      errorCode: ErrorCode.UNKNOWN,
      retryable: false,
    });
  });

  it('marks server errors and rate limits retryable', () => {
    filter.catch(new HttpException('Slow down', 429), host);
    expect(repliedBody()).toMatchObject({
      errorCode: ErrorCode.RATE_LIMITED,
      retryable: true,
    });
  });

  it('hides an unexpected error, still with a code', () => {
    filter.catch(new Error('secret detail'), host);

    expect(repliedBody()).toEqual({
      statusCode: 500,
      message: 'Internal server error',
      errorCode: ErrorCode.INTERNAL,
      retryable: true,
    });
  });

  it('leaves a response already under way alone', () => {
    adapter.isHeadersSent.mockReturnValue(true);

    filter.catch(new PayloadTooLargeException(), host);

    expect(adapter.reply).not.toHaveBeenCalled();
    expect(adapter.end).toHaveBeenCalledWith(response);
  });

  it('does not answer for other transports', () => {
    const error = new Error('ws');
    expect(() =>
      filter.catch(error, {
        getType: () => 'ws',
      } as unknown as ArgumentsHost),
    ).toThrow(error);
  });
});
