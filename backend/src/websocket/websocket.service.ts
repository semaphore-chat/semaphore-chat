import { Injectable, Logger, Optional } from '@nestjs/common';
import { ChannelMentionRedactionService } from '@/roles/channel-mention-redaction.service';
import { Server } from 'socket.io';
import {
  ClientToServerEvents,
  ServerEvents,
  ServerToClientEvents,
  SessionTerminatedReason,
} from '@semaphore-chat/shared';
import { toWirePayload } from './websocket-wire.util';

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;

@Injectable()
export class WebsocketService {
  private readonly logger = new Logger(WebsocketService.name);
  private server: AppServer;

  constructor(
    @Optional()
    private readonly mentionRedaction?: ChannelMentionRedactionService,
  ) {}

  setServer(server: AppServer) {
    this.server = server;
  }

  /** Per-room emit chains, so a redacted (async) emit keeps its order. */
  private readonly pendingByRoom = new Map<string, Promise<void>>();

  /**
   * Emits to a room. A payload carrying #channel mentions is first run
   * through ChannelMentionRedactionService for the room's audience (async);
   * later emits to the same room wait behind it, so order is preserved.
   */
  sendToRoom<E extends keyof ServerToClientEvents>(
    room: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): boolean {
    const needsRedaction =
      !!this.mentionRedaction &&
      args.some((arg) =>
        ChannelMentionRedactionService.hasChannelMentions(arg),
      );
    const pending = this.pendingByRoom.get(room);
    if (!needsRedaction && !pending) return this.emitNow(room, event, ...args);

    const run = (pending ?? Promise.resolve())
      .then(async () => {
        const safeArgs = needsRedaction
          ? ((await Promise.all(
              args.map((arg) => this.mentionRedaction!.forRoom(room, arg)),
            )) as typeof args)
          : args;
        this.emitNow(room, event, ...safeArgs);
      })
      .catch((error) =>
        this.logger.error(
          `Failed to send event "${event}" to room "${room}"`,
          error,
        ),
      );
    this.pendingByRoom.set(room, run);
    void run.finally(() => {
      if (this.pendingByRoom.get(room) === run) this.pendingByRoom.delete(room);
    });
    return true;
  }

  private emitNow<E extends keyof ServerToClientEvents>(
    room: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): boolean {
    if (!this.server) {
      this.logger.error(
        'Attempted to send to room before server was initialized',
      );
      return false;
    }

    try {
      // Normalize to JSON wire form before handing off to the adapter — see
      // toWirePayload doc comment (fixes #440: notepack has no Date codec,
      // so raw Dates would otherwise arrive as `{}` on other replicas).
      const wireArgs = args.map((arg) => toWirePayload(arg)) as typeof args;
      this.server.to(room).emit(event, ...wireArgs);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send event "${event}" to room "${room}"`,
        error,
      );
      return false;
    }
  }

  /**
   * Join all sockets in `sourceRoom` to the given rooms.
   * Typically sourceRoom is a userId (every user joins their own room on connect).
   */
  joinSocketsToRoom(sourceRoom: string, rooms: string | string[]): void {
    if (!this.server) {
      this.logger.error(
        'Attempted to join sockets before server was initialized',
      );
      return;
    }

    try {
      this.server.in(sourceRoom).socketsJoin(rooms);
    } catch (error) {
      this.logger.error(
        `Failed to join sockets in "${sourceRoom}" to rooms`,
        error,
      );
    }
  }

  /**
   * Remove all sockets in `sourceRoom` from the given rooms.
   * Symmetric counterpart to `joinSocketsToRoom()`.
   */
  removeSocketsFromRoom(sourceRoom: string, rooms: string | string[]): void {
    if (!this.server) {
      this.logger.error(
        'Attempted to remove sockets before server was initialized',
      );
      return;
    }

    try {
      this.server.in(sourceRoom).socketsLeave(rooms);
    } catch (error) {
      this.logger.error(
        `Failed to remove sockets in "${sourceRoom}" from rooms`,
        error,
      );
    }
  }

  /**
   * End the session of every socket in `room`, on every instance: tell the
   * client why (SESSION_TERMINATED), then disconnect it. The event is written
   * before the close, so the client receives it first.
   */
  terminateSessionsInRoom(room: string, reason: SessionTerminatedReason): void {
    if (!this.server) {
      this.logger.error(
        'Attempted to disconnect sockets before server was initialized',
      );
      return;
    }

    try {
      this.server.to(room).emit(ServerEvents.SESSION_TERMINATED, { reason });
      this.server.in(room).disconnectSockets(true);
    } catch (error) {
      this.logger.error(`Failed to disconnect sockets in "${room}"`, error);
    }
  }

  sendToAll<E extends keyof ServerToClientEvents>(
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): boolean {
    if (!this.server) {
      this.logger.error(
        'Attempted to send to all before server was initialized',
      );
      return false;
    }

    try {
      // Normalize to JSON wire form before handing off to the adapter — see
      // toWirePayload doc comment (fixes #440: notepack has no Date codec,
      // so raw Dates would otherwise arrive as `{}` on other replicas).
      const wireArgs = args.map((arg) => toWirePayload(arg)) as typeof args;
      this.server.emit(event, ...wireArgs);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send event "${event}" to all clients`,
        error,
      );
      return false;
    }
  }
}
