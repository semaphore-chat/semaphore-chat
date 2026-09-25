import { Injectable, Logger } from '@nestjs/common';
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

  setServer(server: AppServer) {
    this.server = server;
  }

  sendToRoom<E extends keyof ServerToClientEvents>(
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
