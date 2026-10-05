/**
 * useComposerAvailability
 *
 * Tells the message composer whether the current user can post in this
 * context, so it can show a notice instead of an input that silently fails.
 * Everything comes from the channel capabilities (useChannelPermissions):
 *
 * - `read-only`: a read-only or announcement channel where the user isn't
 *   among the roles that may post. `postingRoleNames` names who can.
 * - `no-permission`: the user can't post here for another reason (their
 *   roles, a custom overwrite, a channel they can't see).
 * - `timed-out`: an active community timeout. `until` and a ticking
 *   `remainingMs` drive the countdown; the capabilities are refetched when it
 *   ends, so the state flips back to `ok` on its own.
 * - `banned`: reserved (a ban removes the membership, so the channel isn't
 *   reachable); rendered if a future source supplies it.
 *
 * `canAttach` is false when the user can post but not attach files.
 *
 * DMs are always `ok`. Fails open while the capabilities load or on error;
 * the server enforces either way.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { channelsControllerFindOneOptions } from "../api-client/@tanstack/react-query.gen";
import { useChannelPermissions } from "./useChannelPermissions";
import { VoiceSessionType } from "../contexts/VoiceContext";

export type ComposerAvailabilityState =
  | "ok"
  | "read-only"
  | "no-permission"
  | "timed-out"
  | "banned";

export interface ComposerAvailability {
  state: ComposerAvailabilityState;
  /** When a timeout ends. */
  until?: Date;
  /** Milliseconds left on a timeout; ticks while `state === 'timed-out'`. */
  remainingMs?: number;
  reason?: string;
  /** Channel name for the notice copy, when known. */
  channelName?: string;
  /** Roles that may post (read-only / announcement channels). */
  postingRoleNames?: string[];
  /** Whether attaching files is allowed (only meaningful when `ok`; default true). */
  canAttach?: boolean;
}

export interface UseComposerAvailabilityOptions {
  contextType: VoiceSessionType;
  contextId: string;
  communityId?: string;
  /** Thread composers check `threadReply` instead of `post`. */
  thread?: boolean;
}

const TICK_MS = 1000;
const READ_ONLY_PRESETS = new Set(["READ_ONLY", "ANNOUNCEMENT"]);

export function useComposerAvailability({
  contextType,
  contextId,
  communityId,
  thread = false,
}: UseComposerAvailabilityOptions): ComposerAvailability {
  const isChannel = contextType === VoiceSessionType.Channel && !!communityId && !!contextId;
  const { can, timedOutUntil, postingRoleNames } = useChannelPermissions(
    isChannel ? communityId : undefined,
    isChannel ? contextId : undefined,
  );

  const { data: channel } = useQuery({
    ...channelsControllerFindOneOptions({ path: { id: contextId } }),
    enabled: isChannel,
  });

  const [now, setNow] = useState(() => Date.now());
  const untilMs = timedOutUntil?.getTime();
  const timeoutActive = untilMs !== undefined && untilMs > now;

  useEffect(() => {
    if (untilMs === undefined) return;
    setNow(Date.now());
    const interval = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= untilMs) clearInterval(interval);
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [untilMs]);

  if (!isChannel) return { state: "ok", canAttach: true };

  const channelName = channel?.name;

  if (timeoutActive && timedOutUntil && untilMs !== undefined) {
    return {
      state: "timed-out",
      until: timedOutUntil,
      remainingMs: untilMs - now,
      channelName,
      canAttach: false,
    };
  }

  if (!can(thread ? "threadReply" : "post")) {
    const readOnly = !!channel?.preset && READ_ONLY_PRESETS.has(channel.preset);
    return {
      state: readOnly && can("view") ? "read-only" : "no-permission",
      channelName,
      postingRoleNames,
      canAttach: false,
    };
  }

  return { state: "ok", channelName, canAttach: can("attach") };
}
