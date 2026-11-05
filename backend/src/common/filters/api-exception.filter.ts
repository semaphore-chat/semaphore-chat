import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { AbstractHttpAdapter } from '@nestjs/core';
import {
  errorCodeForStatus,
  isPlainObject,
  withErrorFields,
} from '@/common/errors/error-fields';

/** The adapter, except that error bodies gain the client-facing fields. */
function addingErrorFields(adapter: AbstractHttpAdapter): AbstractHttpAdapter {
  const wrapped = Object.create(adapter) as AbstractHttpAdapter;
  wrapped.reply = (response: unknown, body: unknown, status?: number) => {
    adapter.reply(
      response,
      isPlainObject(body)
        ? withErrorFields(body, errorCodeForStatus(status ?? 500))
        : body,
      status,
    );
  };
  return wrapped;
}

/**
 * Nest's HTTP error responses, with `errorCode` and `retryable` added to the
 * body. Existing fields, statuses and logging stay as Nest has them, so clients
 * reading the old fields see no change, and every exception gets a code from
 * its status until its site needs a specific one.
 *
 * Gateways have their own filter (WsLoggingExceptionFilter).
 */
@Catch()
export class ApiExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;

    // Here, not in a constructor: a testing module builds this filter before
    // the adapter exists.
    const adapter = addingErrorFields(this.httpAdapterHost!.httpAdapter);

    if (!(exception instanceof HttpException)) {
      return this.handleUnknownError(exception, host, adapter);
    }

    const response: unknown = host.getArgByIndex(1);
    if (adapter.isHeadersSent(response)) {
      adapter.end(response);
      return;
    }
    const body = exception.getResponse();
    adapter.reply(
      response,
      typeof body === 'string'
        ? { statusCode: exception.getStatus(), message: body }
        : body,
      exception.getStatus(),
    );
  }
}
