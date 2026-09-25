import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/**
 * A DTO that failed validation. Over HTTP it is the same 400 as the stock
 * ValidationPipe's (`{ statusCode, message: string[], error }`); it also
 * carries the class-validator errors, which `WsLoggingExceptionFilter` sends
 * to WebSocket clients as a `WsException`.
 */
export class ValidationFailedException extends BadRequestException {
  constructor(
    readonly validationErrors: ValidationError[],
    messages: string[],
  ) {
    super(messages);
  }
}

/**
 * The app's global ValidationPipe, for HTTP routes and WebSocket gateways.
 *
 * Since Nest 12, global pipes also run for gateway handlers, and a pipe
 * can't tell them apart: `@Body()` and `@MessageBody()` both arrive as
 * `type: 'body'`. So this one pipe validates both, once, and its failure
 * (`ValidationFailedException`) renders correctly on either side.
 */
export class AppValidationPipe extends ValidationPipe {
  constructor() {
    super({
      transform: true,
      whitelist: true,
      // WebSocket clients get the ValidationError objects themselves; leave
      // the DTO instance and the rejected value out of them. HTTP responses
      // only carry the messages, so this doesn't change them.
      validationError: { target: false, value: false },
    });
  }

  createExceptionFactory() {
    return (errors: ValidationError[] = []) =>
      new ValidationFailedException(
        errors,
        this.flattenValidationErrors(errors),
      );
  }
}
