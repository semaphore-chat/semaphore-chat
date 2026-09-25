import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class TimingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TimingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = Date.now();
    const label = this.getLabel(context);
    // Since Nest 12 global interceptors run for gateway handlers too, i.e.
    // on every WebSocket message (typing, presence, ...); keep those out of
    // the info log.
    const logAtDebug = context.getType() === 'ws';

    return next.handle().pipe(
      tap(() => {
        const message = `${label} - ${Date.now() - start}ms`;
        if (logAtDebug) {
          this.logger.debug(message);
        } else {
          this.logger.log(message);
        }
      }),
    );
  }

  private getLabel(context: ExecutionContext): string {
    const type = context.getType();

    if (type === 'http') {
      const req = context.switchToHttp().getRequest<Request>();
      return `HTTP ${req.method} ${req.originalUrl || req.url}`;
    }

    if (type === 'ws') {
      const pattern = String(
        Reflect.getMetadata('message', context.getHandler()) ?? '',
      );
      const gateway = context.getClass().name;
      return `WS ${gateway}:${pattern || context.getHandler().name}`;
    }

    return `${type} ${context.getClass().name}.${context.getHandler().name}`;
  }
}
