import { Injectable } from '@nestjs/common';
import { toWirePayload } from '@/websocket/websocket-wire.util';
import { ChannelAccessService } from './channel-access.service';

interface ChannelMentionSpan {
  type: 'CHANNEL_MENTION';
  channelId: string | null;
}

function isChannelMention(value: unknown): value is ChannelMentionSpan {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'CHANNEL_MENTION' &&
    typeof (value as { channelId?: unknown }).channelId === 'string'
  );
}

/** Values not to walk into: binary data and streams (file responses). */
function isOpaque(value: object): boolean {
  return (
    value instanceof Date ||
    Buffer.isBuffer(value) ||
    ArrayBuffer.isView(value) ||
    typeof (value as { pipe?: unknown }).pipe === 'function'
  );
}

/** Every CHANNEL_MENTION span with a channelId, anywhere inside `value`. */
function collect(
  value: unknown,
  out: ChannelMentionSpan[] = [],
  seen = new WeakSet<object>(),
): ChannelMentionSpan[] {
  if (!value || typeof value !== 'object' || isOpaque(value)) return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out, seen);
  } else if (isChannelMention(value)) {
    out.push(value);
  } else {
    for (const child of Object.values(value)) collect(child, out, seen);
  }
  return out;
}

/**
 * Per-reader redaction of #channel mentions: a reader who can't view the
 * mentioned channel must not learn its id (they render "#private-channel").
 * The ONE formatting step for spans leaving the server: the REST
 * interceptor (ChannelMentionRedactionInterceptor) runs every response
 * through `forUser`, and WebsocketService runs every socket payload
 * through `forRoom`. REST responses are redacted in place (fresh per
 * request; keeps class instances for the serializer); socket payloads are
 * first converted to their wire form (a copy).
 */
@Injectable()
export class ChannelMentionRedactionService {
  constructor(private readonly channelAccessService: ChannelAccessService) {}

  /** Cheap pre-check: does the value carry any channel mention with an id? */
  static hasChannelMentions(value: unknown): boolean {
    return collect(value).length > 0;
  }

  /** Redact what `userId` can't see. `null` user (unauthenticated): all. */
  async forUser<T>(userId: string | null, value: T): Promise<T> {
    return this.redact(value, async (channelId) =>
      userId
        ? this.channelAccessService.canViewChannel(userId, channelId)
        : false,
    );
  }

  /**
   * Redact for everyone who receives a broadcast to `room`: a mention keeps
   * its id only if every member of the room's audience can view it.
   */
  async forRoom<T>(room: string, payload: T): Promise<T> {
    const value = toWirePayload(payload);
    if (room.startsWith('user:')) {
      return this.forUser(room.slice('user:'.length), value);
    }
    if (room.startsWith('community:')) {
      return this.redact(value, (id) =>
        this.channelAccessService.isVisibleToWholeCommunity(id),
      );
    }
    if (room.includes(':')) {
      // DM, session and token rooms carry no channel mentions worth keeping
      return this.redact(value, () => Promise.resolve(false));
    }
    // A channel room: its sockets are the channel's viewers
    const audience = room;
    let audienceViewers: Set<string> | null = null;
    return this.redact(value, async (mentioned) => {
      if (mentioned === audience) return true;
      if (
        await this.channelAccessService.isVisibleToWholeCommunity(mentioned)
      ) {
        return true;
      }
      audienceViewers ??= new Set(
        await this.channelAccessService.viewerUserIds(audience),
      );
      const mentionedViewers = new Set(
        await this.channelAccessService.viewerUserIds(mentioned),
      );
      return [...audienceViewers].every((u) => mentionedViewers.has(u));
    });
  }

  private async redact<T>(
    value: T,
    canSee: (channelId: string) => Promise<boolean>,
  ): Promise<T> {
    if (!value || typeof value !== 'object') return value;
    const spans = collect(value);
    if (spans.length === 0) return value;
    const ids = [...new Set(spans.map((s) => s.channelId as string))];
    const visible = new Map<string, boolean>();
    for (const id of ids) visible.set(id, await canSee(id));
    for (const span of spans) {
      if (!visible.get(span.channelId as string)) span.channelId = null;
    }
    return value;
  }
}
