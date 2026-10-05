import {
  CallHandler,
  ExecutionContext,
  Injectable,
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
  constructor(private readonly redaction: ChannelMentionRedactionService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{ user?: { id?: string } }>();
    return next
      .handle()
      .pipe(
        mergeMap((body: unknown) =>
          ChannelMentionRedactionService.hasChannelMentions(body)
            ? this.redaction.forUser(req.user?.id ?? null, body)
            : Promise.resolve(body),
        ),
      );
  }
}
