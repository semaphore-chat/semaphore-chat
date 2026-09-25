/**
 * Centralized room name construction for WebSocket rooms.
 *
 * Ensures consistent naming between:
 * - `RoomsService.joinAllUserRooms()` (initial socket connect)
 * - `RoomSubscriptionHandler` (mid-session subscription changes)
 * - Any service that sends events via `WebsocketService.sendToRoom()`
 *
 * Prefixed entities: `community:`, `user:`, `dm:`, `session:`, `token:`.
 * Raw IDs: channels, alias groups (used directly as room IDs).
 */
export const RoomName = {
  user: (userId: string): string => `user:${userId}`,
  community: (communityId: string): string => `community:${communityId}`,
  channel: (channelId: string): string => channelId,
  dmGroup: (groupId: string): string => `dm:${groupId}`,
  aliasGroup: (aliasGroupId: string): string => aliasGroupId,
  /** Every socket authenticated with a session (refresh token family). */
  session: (sessionId: string): string => `session:${sessionId}`,
  /** Every socket authenticated with one access token. */
  accessToken: (jti: string): string => `token:${jti}`,
} as const;
