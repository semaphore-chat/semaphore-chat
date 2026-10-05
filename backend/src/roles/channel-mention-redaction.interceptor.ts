import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, mergeMap } from 'rxjs';
import { ChannelMentionRedactionService } from './channel-mention-redaction.service';

/**
 * Global: every REST response goes through per-reader #channel mention
 * redaction (message lists, search, threads, pins, notifications, reply
 * previews...), so no path can forget it.
 */
@Injectable()
export class ChannelMentionRedactionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ChannelMentionRedactionInterceptor.name);

  constructor(private readonly redaction: ChannelMentionRedactionService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{ user?: { id?: string } }>();
    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        if (!ChannelMentionRedactionService.hasChannelMentions(body)) {
          return body;
        }
        try {
          return await this.redaction.forUser(req.user?.id ?? null, body);
        } catch (error) {
          // Don't fail the request: answer with every mention id removed
          this.logger.error(
            'Mention redaction failed; responding with all channel mention ids removed',
            error,
          );
          return ChannelMentionRedactionService.redactAll(body);
        }
      }),
    );
  }
}
