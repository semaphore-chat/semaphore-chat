import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, mergeMap } from 'rxjs';
import {
  blankRemovedMessagesForReader,
  RemovableMessage,
} from '@/common/utils/removed-message.utils';
import { PermissionsService } from './permissions.service';

const isRow = (value: unknown): value is RemovableMessage =>
  !!value && typeof value === 'object' && 'deletedAt' in value;

/**
 * Applies removed-message visibility to everything a message-returning
 * controller answers: one message, an array, or `{ messages }` / `{ replies }`.
 * A failed permission check fails the request: it never delivers the content.
 */
@Injectable()
export class RemovedMessageVisibilityInterceptor implements NestInterceptor {
  constructor(private readonly permissionsService: PermissionsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: { id?: string } }>();
    const userId = req.user?.id;
    const forReader = <T extends RemovableMessage>(rows: T[]) =>
      blankRemovedMessagesForReader(rows, (channelId) =>
        userId
          ? this.permissionsService.canSeeRemovedMessages(userId, channelId)
          : Promise.resolve(false),
      );

    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        if (Array.isArray(body)) {
          return body.every(isRow) ? forReader(body) : body;
        }
        if (isRow(body)) return (await forReader([body]))[0];
        if (!body || typeof body !== 'object') return body;

        const page = body as { messages?: unknown; replies?: unknown };
        for (const key of ['messages', 'replies'] as const) {
          const rows = page[key];
          if (Array.isArray(rows) && rows.every(isRow)) {
            return { ...page, [key]: await forReader(rows) };
          }
        }
        return body;
      }),
    );
  }
}
