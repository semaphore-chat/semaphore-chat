import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ServerEvents } from '@semaphore-chat/shared';
import { MessagesService } from './messages.service';
import { WebsocketService } from '@/websocket/websocket.service';
import {
  MESSAGE_FANOUT_QUEUE,
  LINK_PREVIEWS_QUEUE,
} from '@/jobs/jobs.constants';
import { MessageFanoutJobData, LinkPreviewJobData } from '@/jobs/jobs.types';
import { toWireMessage } from '@/common/utils/message-wire.utils';

/** The shape returned by `MessagesService.create()` — enriched by dispatch(). */
type DispatchableMessage = Awaited<ReturnType<MessagesService['create']>>;

export interface MessageDispatchOptions {
  /** Room to broadcast to — a raw channelId or `RoomName.dmGroup(id)`. */
  room: string;
  /**
   * Event to emit alongside the enriched message payload. Only
   * NEW_MESSAGE (channel sends) and NEW_DM (DM sends) are ever passed —
   * narrowed from `ServerEvents` so the payload below type-checks against
   * `NewMessagePayload` specifically (every ServerEvents member would
   * require the payload to satisfy every event's payload type at once).
   */
  event: ServerEvents.NEW_MESSAGE | ServerEvents.NEW_DM;
  /** Whether to fire mention/DM notification processing for this message. */
  notifications: boolean;
  /** Whether to fire link-preview processing for this message. */
  linkPreviews: boolean;
}

/**
 * Shared post-create message pipeline used by every path that creates a
 * message (channel SEND_MESSAGE, SEND_DM, incoming webhooks): enrich the
 * message with file metadata, broadcast it to the target room, then enqueue
 * the non-blocking side effects (notifications, link previews) onto their
 * BullMQ queues.
 *
 * User-specific steps (timeout checks, slowmode, read-receipt auto-mark)
 * are NOT part of this pipeline — those stay in the caller.
 *
 * The two side effects are queued rather than run in-process: this is the
 * seam issue B1 (BullMQ job queue) was designed around, so that side
 * effects survive an API process restart and get automatic retries instead
 * of being silently lost as fire-and-forget promises.
 */
@Injectable()
export class MessageDispatchService {
  private readonly logger = new Logger(MessageDispatchService.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly websocketService: WebsocketService,
    @InjectQueue(MESSAGE_FANOUT_QUEUE)
    private readonly messageFanoutQueue: Queue<MessageFanoutJobData>,
    @InjectQueue(LINK_PREVIEWS_QUEUE)
    private readonly linkPreviewsQueue: Queue<LinkPreviewJobData>,
  ) {}

  // Deliberately NOT `async`: the body below has nothing left to await (see
  // the fire-and-forget comment) — an `async` function with no `await`
  // would trip `@typescript-eslint/require-await`. The explicit
  // `Promise.resolve()` return keeps the public signature (`Promise<void>`,
  // already `await`-ed by every caller) unchanged.
  dispatch(
    message: DispatchableMessage,
    opts: MessageDispatchOptions,
  ): Promise<void> {
    this.websocketService.sendToRoom(opts.room, opts.event, {
      message: toWireMessage(message),
    });

    // Fire-and-forget: the message-send ack (this method's resolution) must
    // not depend on the queue/Redis round-trip. Both enqueue methods already
    // catch and log internally, so a rejected enqueue never surfaces here
    // whether we await it or not — not awaiting just means dispatch() no
    // longer waits on it. If Redis is down, the enqueue is lost exactly like
    // a fire-and-forget side effect was lost in the pre-queue architecture —
    // an accepted tradeoff to keep message-send acks fast and independent of
    // queue availability.
    if (opts.notifications) {
      void this.enqueueNotificationFanout(message);
    }

    if (opts.linkPreviews) {
      void this.enqueueLinkPreviews(message, opts.room);
    }

    return Promise.resolve();
  }

  /**
   * Enqueue notification fan-out (mentions, DMs, channel-message "all"
   * level) for processing by NotificationsFanoutProcessor.
   *
   * jobId `fanout-${messageId}` makes re-dispatch of the same message
   * idempotent — a duplicate enqueue attempt for a message that's already
   * queued/active is a no-op rather than a second fan-out. NOTE: the `-`
   * separator is load-bearing — BullMQ rejects custom jobIds containing
   * `:` ("Custom Id cannot contain :") since `:` is its Redis key
   * delimiter, and the enqueue's catch would swallow that error silently.
   *
   * Enqueue failures are logged and swallowed (never rethrown): message
   * creation has already succeeded and broadcast by this point, and a
   * transient Redis hiccup on the side-effect path shouldn't fail the
   * request that created the message.
   */
  private async enqueueNotificationFanout(
    message: DispatchableMessage,
  ): Promise<void> {
    try {
      await this.messageFanoutQueue.add(
        'fanout',
        { messageId: message.id },
        { jobId: `fanout-${message.id}` },
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue notification fan-out for message ${message.id}`,
        error,
      );
    }
  }

  /**
   * Enqueue link-preview processing for processing by LinkPreviewsProcessor.
   *
   * jobId `preview-${messageId}` (no edit suffix) — this is the CREATE path;
   * the message-edit path (messages.controller.ts#update) enqueues with a
   * distinct `preview-${messageId}-edit-${uuid}` jobId so an edit's
   * reprocessing is never swallowed as a duplicate of the create job.
   * (`-` separator for the same BullMQ no-colon rule as above.)
   *
   * Always broadcasts as UPDATE_MESSAGE regardless of the original dispatch
   * event (NEW_MESSAGE/NEW_DM) — link-preview processing re-emits the
   * message as an *update* once previews are fetched, matching prior
   * (pre-queue) behavior.
   */
  private async enqueueLinkPreviews(
    message: DispatchableMessage,
    room: string,
  ): Promise<void> {
    try {
      await this.linkPreviewsQueue.add(
        'process',
        { messageId: message.id, room, event: ServerEvents.UPDATE_MESSAGE },
        { jobId: `preview-${message.id}` },
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue link preview processing for message ${message.id}`,
        error,
      );
    }
  }
}
