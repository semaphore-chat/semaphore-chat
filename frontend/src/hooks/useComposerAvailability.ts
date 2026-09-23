/**
 * useComposerAvailability
 *
 * Tells the message composer whether the current user can post in this
 * context, so it can show a notice instead of an input that silently fails.
 *
 * - `no-permission`: the user's channel roles lack CREATE_MESSAGE.
 * - `timed-out`: the community has an active timeout for the user
 *   (`GET /moderation/timeout-status/:communityId/:userId`). `until` and a
 *   ticking `remainingMs` drive the countdown; the state flips back to `ok`
 *   on expiry.
 * - `banned`: reserved. A ban removes the membership and roles, so a banned
 *   user can't load the channel at all, and there is no self-service "am I
 *   banned" endpoint. The hook never returns it today; the composer still
 *   renders it if a future source supplies it.
 *
 * `reason` is also reserved: the timeout-status DTO has no reason, and the
 * timeout list that has one needs moderation permissions.
 *
 * DMs are always `ok`. The hook fails open: while permissions or the timeout
 * status are loading, or if either request errors, it reports `ok` and
 * leaves enforcement to the server.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  channelsControllerFindOneOptions,
  moderationControllerGetTimeoutStatusOptions,
  moderationControllerGetTimeoutStatusQueryKey,
} from "../api-client/@tanstack/react-query.gen";
import { useUserPermissions } from "../features/roles/useUserPermissions";
import { useCurrentUser } from "./useCurrentUser";
import { VoiceSessionType } from "../contexts/VoiceContext";

export type ComposerAvailabilityState = "ok" | "no-permission" | "timed-out" | "banned";

export interface ComposerAvailability {
  state: ComposerAvailabilityState;
  /** When a timeout ends. */
  until?: Date;
  /** Milliseconds left on a timeout; ticks while `state === 'timed-out'`. */
  remainingMs?: number;
  reason?: string;
  /** Channel name for the notice copy, when known. */
  channelName?: string;
}

export interface UseComposerAvailabilityOptions {
  contextType: VoiceSessionType;
  contextId: string;
  communityId?: string;
}

const CREATE_MESSAGE = ["CREATE_MESSAGE"];
const TICK_MS = 1000;

export function useComposerAvailability({
  contextType,
  contextId,
  communityId,
}: UseComposerAvailabilityOptions): ComposerAvailability {
  const isChannel = contextType === VoiceSessionType.Channel && !!communityId && !!contextId;
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const userId = user?.id;

  const { hasPermissions, isLoading: permissionsLoading, roles } = useUserPermissions({
    resourceType: "CHANNEL",
    resourceId: isChannel ? contextId : undefined,
    actions: CREATE_MESSAGE,
  });

  const { data: timeoutStatus } = useQuery({
    ...moderationControllerGetTimeoutStatusOptions({
      path: { communityId: communityId ?? "", userId: userId ?? "" },
    }),
    enabled: isChannel && !!userId,
  });

  const { data: channel } = useQuery({
    ...channelsControllerFindOneOptions({ path: { id: contextId } }),
    enabled: isChannel,
  });

  const until = useMemo(() => {
    if (!isChannel || !timeoutStatus?.isTimedOut || !timeoutStatus.expiresAt) return undefined;
    const date = new Date(timeoutStatus.expiresAt);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }, [isChannel, timeoutStatus]);

  const [now, setNow] = useState(() => Date.now());
  const untilMs = until?.getTime();
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

  // Once the countdown runs out, refetch so the cache matches the server.
  const expired = untilMs !== undefined && untilMs <= now;
  useEffect(() => {
    if (!expired || !communityId || !userId) return;
    void queryClient.invalidateQueries({
      queryKey: moderationControllerGetTimeoutStatusQueryKey({ path: { communityId, userId } }),
    });
  }, [expired, communityId, userId, queryClient]);

  if (!isChannel) return { state: "ok" };

  const channelName = channel?.name;

  // Only report no-permission once the roles actually loaded (fail open on
  // loading or error; the server still rejects the send).
  if (!permissionsLoading && roles && !hasPermissions) {
    return { state: "no-permission", channelName };
  }

  if (timeoutActive && until) {
    return { state: "timed-out", until, remainingMs: untilMs - now, channelName };
  }

  return { state: "ok", channelName };
}
