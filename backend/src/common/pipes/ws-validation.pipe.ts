import { ValidationPipe } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

export const wsValidationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  validationError: {
    target: false,
    value: false,
  },
  exceptionFactory: (errors) => new WsException(errors),
});
