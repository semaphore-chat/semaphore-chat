import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { ApiErrorFields, ErrorCode, SendAck } from '@semaphore-chat/shared';
import type { Socket } from 'socket.io';
import { answersFailureWithAck } from './send-ack';
import {
  errorCodeForStatus,
  isPlainObject,
  withErrorFields,
} from '@/common/errors/error-fields';
import { ValidationFailedException } from '@/common/pipes/app-validation.pipe';

/** Codes for the plain-string errors Nest and BaseWsExceptionFilter send. */
const CODE_FOR_MESSAGE: Partial<Record<string, ErrorCode>> = {
  'Forbidden resource': ErrorCode.FORBIDDEN,
  'Internal server error': ErrorCode.INTERNAL,
};

@Catch()
export class WsLoggingExceptionFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsLoggingExceptionFilter.name);

  catch(caught: unknown, host: ArgumentsHost) {
    const exception = this.toWsException(caught, host);

    // TypeScript strict mode: getData() returns any, so we must suppress the warning for this assignment
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const data = host.switchToWs().getData();

    if (exception instanceof WsException) {
      this.logger.error(
        `WebSocket WsException: ${exception.message} | Data: ${JSON.stringify(data)}`,
        (exception as Error).stack,
      );
    } else if (exception instanceof Error) {
      this.logger.error(
        `WebSocket Error: ${exception.message} | Data: ${JSON.stringify(data)}`,
        exception.stack,
      );
    } else {
      this.logger.error(
        `WebSocket Unknown Exception: ${JSON.stringify(exception)} | Data: ${JSON.stringify(data)}`,
        undefined,
      );
    }
    super.catch(exception, host);
    this.answerAck(exception, host);
  }

  /** Fails the ack of a send, for a client that asked (see send-ack.ts). */
  private answerAck(exception: unknown, host: ArgumentsHost) {
    const ws = host.switchToWs();
    const ack: unknown = host.getArgByIndex(2);
    if (
      typeof ack !== 'function' ||
      !answersFailureWithAck(ws.getClient<Socket>(), ws.getPattern())
    ) {
      return;
    }

    const error =
      exception instanceof WsException ? exception.getError() : null;
    const fields = Array.isArray(error)
      ? {
          message: 'Validation failed',
          errorCode: ErrorCode.VALIDATION_FAILED,
        }
      : isPlainObject(error)
        ? error
        : { message: error ?? 'Internal server error' };
    const message = fields.message;
    const { errorCode, retryable, retryAfterMs } = withErrorFields(
      fields,
      (typeof message === 'string' && CODE_FOR_MESSAGE[message]) ||
        (error === null ? ErrorCode.INTERNAL : ErrorCode.BAD_REQUEST),
    ) as ApiErrorFields;

    (ack as (answer: SendAck) => void)({
      ok: false,
      error: {
        errorCode,
        message: Array.isArray(message) ? message.join('. ') : String(message),
        retryable,
        ...(retryAfterMs ? { retryAfterMs } : {}),
      },
    });
  }

  /** The last stop for every error payload, so all of them get the fields. */
  emitMessage(client: never, event: string, payload: unknown) {
    const message = isPlainObject(payload) ? payload.message : undefined;
    super.emitMessage(
      client,
      event,
      isPlainObject(payload)
        ? withErrorFields(
            payload,
            (typeof message === 'string' && CODE_FOR_MESSAGE[message]) ||
              ErrorCode.BAD_REQUEST,
          )
        : payload,
    );
  }

  private toWsException(caught: unknown, host: ArgumentsHost): unknown {
    // The global AppValidationPipe validates gateway payloads too (Nest 12
    // runs global pipes on gateways). Send its failures as a WsException
    // carrying the class-validator errors, as gateways did before Nest 12,
    // instead of letting BaseWsExceptionFilter report a BadRequestException
    // as "Internal server error".
    if (caught instanceof ValidationFailedException) {
      return new WsException(caught.validationErrors);
    }

    // Same for an error a service threw for a client to read. Anything else
    // stays "Internal server error": it may hold details clients shouldn't see.
    if (caught instanceof HttpException) {
      const response = caught.getResponse();
      const body = isPlainObject(response) ? response : { message: response };
      const ws = host.switchToWs();
      return new WsException(
        withErrorFields(
          {
            status: 'error',
            message: body.message,
            ...(body.errorCode ? { errorCode: body.errorCode } : {}),
            ...(body.retryAfterMs ? { retryAfterMs: body.retryAfterMs } : {}),
            cause: { pattern: ws.getPattern(), data: ws.getData<unknown>() },
          },
          errorCodeForStatus(caught.getStatus()),
        ),
      );
    }

    return caught;
  }
}
